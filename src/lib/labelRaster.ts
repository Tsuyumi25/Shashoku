import type { EngineSpan } from '@shared/engine/types'
import { parseMarkup, resolveSpans } from '@shared/page/markup'
import { byteAt, byteOffsets } from './textProjection'
import type { LayerEffect } from '@shared/effects/types'
import type { TextStyle } from '@shared/text-style/types'
import { engineStrokeFor } from '@shared/effects/stroke'
import {
  catalogByFace,
  catalogByFamily,
  catalogLoaded,
  defaultFamily,
  representativeOf,
} from './fontCatalog'
import { measureFor, sampleFor, type Sample } from './fontSampleCache'
import {
  frameCenter,
  labelBoxSize,
  layoutOrigin,
  placeLabel,
  quantizeRotation,
  type Point,
} from './labelBox'

export interface LabelRaster {
  /**
   * Null only when there is nothing to draw at all — an empty label, or a
   * catalogue that has not answered yet. A family this machine does not have
   * still draws, as a notdef box.
   */
  sample: Sample | null
  /**
   * The family the object asked for, when this machine has no usable face for
   * it — absent from the catalogue, or present but undrawable. Empty when no
   * family was asked for at all, which is a project without a default font
   * rather than a machine missing one, and a different thing to tell someone.
   * Null when there was nothing to draw in the first place.
   *
   * The object draws in all three cases; this is what says the drawing stands
   * in for its text. Held as the name rather than as a message so the
   * interface can word it.
   */
  missingFamily: string | null
}

const NO_PHASE: Point = { x: 0, y: 0 }

const NOTHING: LabelRaster = { sample: null, missingFamily: null }

/**
 * The resolution chain of ADR 0001: the named face, then the family's
 * representative, then nothing — which the caller draws as notdef. Only
 * `fontFace` is ever compared; the family is a fallback for objects that
 * predate choosing one, or whose exact face this machine lacks while a
 * sibling weight is present.
 */
function resolveFace(style: TextStyle) {
  const exact = style.fontFace ? catalogByFace.value.get(style.fontFace) : undefined
  if (exact) return exact
  // ⭐ A style that names nothing takes the machine's default; one that names a
  // family this machine lacks takes the boxes. The two look alike and are
  // opposite: the second is a project saying something this computer cannot
  // honour, and answering it with another face would draw a page in a font the
  // project does not name. See ADR 0001.
  const family = style.fontFamily || defaultFamily.value
  const faces = catalogByFamily.value.get(family)
  return faces ? representativeOf(faces) : null
}

/**
 * One label's bitmap. Shared because the frame is sized from what the text
 * actually came out as, and a frame that measured a second rasterization of its
 * own would be a mismatch waiting to happen. Reads module state rather than
 * taking it, so a caller inside a `computed` tracks the catalogue for free;
 * repeat calls land on the sample cache.
 *
 * A family this machine has no face for draws a grid of notdef boxes rather
 * than nothing. That keeps "cannot be drawn" out of every surface downstream:
 * an object always has a bitmap, so the canvas and the export are the same
 * picture and neither has a failure case to handle. It is not font fallback —
 * no second face is consulted, and the boxes say so rather than impersonating
 * the text (see ADR 0001).
 */
function requestFor(
  painted: PaintedText,
  style: TextStyle,
  effects: readonly LayerEffect[],
  phase: Point,
  rotation: number,
) {
  return {
    text: painted.plain,
    spans: painted.spans,
    sizePx: style.fontSizePx,
    fillColor: style.color,
    stroke: engineStrokeFor(effects),
    vertical: style.direction === 'vertical',
    align: style.align,
    weightPx: style.weightPx,
    rotation,
    phaseX: phase.x,
    phaseY: phase.y,
  }
}

/**
 * A body's stored string read as what actually gets set: the text with its
 * tags taken out, and the runs those tags describe in the engine's own byte
 * offsets.
 *
 * The seam the markup crosses into the typesetter. Every surface hands the
 * code in and nothing downstream of here has heard of a tag — which is what
 * keeps the canvas, the export and the frame one answer rather than three
 * parsers hoping to agree.
 */
export interface PaintedText {
  plain: string
  spans: EngineSpan[]
}

export function paintedText(code: string, style: TextStyle): PaintedText {
  const markup = parseMarkup(code)
  const resolved = resolveSpans(markup, {
    fontSizePx: style.fontSizePx,
    color: style.color,
    weightPx: style.weightPx,
  })
  if (resolved.length === 0) return { plain: markup.plain, spans: [] }
  // The engine counts in UTF-8 bytes of the plain text; a span counts in the
  // JS string units a native input reports. Converted once here, where the
  // plain text both of them describe is in hand.
  const table = byteOffsets(markup.plain)
  return {
    plain: markup.plain,
    spans: resolved.map((span) => ({
      start: byteAt(table, span.start),
      end: byteAt(table, span.end),
      sizePx: span.sizePx,
      color: span.color,
      weightPx: span.weightPx,
      upright: span.upright,
    })),
  }
}

function rasterFor(
  painted: PaintedText,
  style: TextStyle,
  effects: readonly LayerEffect[],
  phase: Point = NO_PHASE,
  rotation = 0,
): LabelRaster {
  if (painted.plain.length === 0) return NOTHING

  const entry = resolveFace(style)
  // Nothing to say while the catalogue is still being enumerated: the family
  // is not missing yet, it is unanswered — and a box drawn on every start
  // would say the wrong one.
  if (!entry && !catalogLoaded.value) return NOTHING

  const req = requestFor(painted, style, effects, phase, rotation)

  if (entry) {
    try {
      return { sample: sampleFor({ ...req, entry }), missingFamily: null }
    } catch {
      // Catalogued but undrawable — a file moved since the scan, or one the
      // engine cannot parse. That leaves the machine with no usable face for
      // this object, which is the case below.
    }
  }
  return { sample: sampleFor({ ...req, entry: null }), missingFamily: style.fontFamily }
}

/**
 * The frame `rasterFor` would draw in, through the same resolution chain and
 * the same fallbacks, with nothing painted. Null exactly when `rasterFor`
 * would have no sample — the answer that decides is the same one.
 */
function measured(
  painted: PaintedText,
  style: TextStyle,
  effects: readonly LayerEffect[],
  rotation = 0,
): { width: number; height: number } | null {
  if (painted.plain.length === 0) return null

  const entry = resolveFace(style)
  if (!entry && !catalogLoaded.value) return null

  const req = requestFor(painted, style, effects, NO_PHASE, rotation)

  if (entry) {
    try {
      return measureFor({ ...req, entry })
    } catch {
      // Catalogued but undrawable, as in rasterFor: measure the notdef grid
      // that will end up drawn instead.
    }
  }
  return measureFor({ ...req, entry: null })
}

/**
 * Whether this machine has no face for the family, without drawing anything.
 *
 * For surfaces that show one row per object and would otherwise rasterize a
 * whole page to label them. It answers from the catalogue alone, so a family
 * that is listed but turns out to be undrawable reads as present here while
 * the canvas shows notdef boxes — the rarer case, and the one the canvas is
 * already honest about.
 *
 * False while the catalogue is still being enumerated: not yet answered is not
 * the same as absent.
 */
export function familyIsMissing(family: string): boolean {
  return catalogLoaded.value && !catalogByFamily.value.has(family)
}

/**
 * What to say about an object that is drawing notdef boxes.
 *
 * An empty family is not a font this machine failed to find — it is a project
 * that has not been given a default font yet, which is the user's next move
 * rather than a fault. Shared by the frame and the layer tree so the two
 * cannot word the same state differently; it moves to the message catalogue
 * once there is one.
 */
export function missingFamilyLabel(family: string): string {
  return family === '' ? '尚未選擇字型' : `這台機器沒有字型「${family}」`
}

export interface DrawnLabel {
  /**
   * Null when there is nothing to draw — an empty label, or a catalogue that
   * has not answered yet. The frame still exists in both cases, which is what
   * keeps an empty label reachable instead of invisible.
   *
   * Already turned by the object's own angle. Its size is therefore the
   * rectangle that turn needed, not `box`; draw it at its own dimensions.
   */
  sample: Sample | null
  /** Set when what got drawn is a notdef box rather than the object's text. */
  missingFamily: string | null
  /**
   * What the object measures standing upright, which is what the frame is
   * drawn from — a turned frame is the same rectangle rotated, so grabbing it
   * still grabs the object rather than the box its turn happens to fill.
   */
  box: { w: number; h: number }
  /** Where the bitmap's centre goes, so its corner lands on the page grid. */
  center: Point
  /**
   * The text the bitmap shows — the code's own words with its tags taken out.
   *
   * Published because every caret, click and selection on a drawn label is an
   * offset into this and not into the code: the bitmap set it, so the bitmap
   * is what says which string the cluster table counts in.
   */
  plain: string
}

/**
 * One label, ready to draw: the bitmap, the frame around it, and where to put
 * that frame so the bitmap's corner lands on the page's own grid.
 *
 * `at` is the object's stored position, and which point of the frame that names
 * follows from the style's alignment — so a frame reached through here has
 * already grown away from that point rather than around its middle.
 *
 * Every surface that draws a label goes through here, which is the point. What
 * the canvas shows matching what exports is then a property of there being one
 * answer rather than a hope that two draw sites keep computing the same one.
 *
 * It asks the engine three questions and only the last one paints:
 *
 * 1. Upright and unphased, measured — what the object's own size is. The frame
 *    takes this, so what you grab stays the object rather than the rectangle
 *    its turn happens to need.
 * 2. Turned and unphased, measured — how big the bitmap that gets blitted is.
 *    The phase is derived from that, since that is the thing landing on the
 *    grid. At an angle of zero this is the first question again.
 * 3. Turned and phased, rasterized — the bitmap to draw.
 *
 * The measures cost a fraction of a percent of a raster, so a fresh label
 * costs one rasterization however it is turned; the phase is quantised so a
 * drag adds a handful rather than one per frame.
 */
export function drawnLabel(
  code: string,
  style: TextStyle,
  effects: readonly LayerEffect[],
  at: Point,
  rotation = 0,
): DrawnLabel {
  const turn = quantizeRotation(rotation)
  const painted = paintedText(code, style)

  const upright = measured(painted, style, effects)
  const box = labelBoxSize(style, upright)
  // The turned bitmap holds the run at its own middle, so both rectangles share
  // one centre and the frame is the same point as the ink.
  const middle = frameCenter(at, box, layoutOrigin(style), turn)
  if (!upright) {
    const center = placeLabel(middle, box, turn).center
    return { sample: null, missingFamily: null, box, center, plain: painted.plain }
  }

  const spun = turn === 0 ? upright : measured(painted, style, effects, turn)
  const blit = spun ? { w: spun.width, h: spun.height } : box
  const { center, phase } = placeLabel(middle, blit, turn)
  return { ...rasterFor(painted, style, effects, phase, turn), box, center, plain: painted.plain }
}
