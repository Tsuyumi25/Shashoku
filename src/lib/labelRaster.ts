import type { TextStyle } from '@shared/text-style/types'
import { catalogByFamily, catalogLoaded, representativeOf } from './fontCatalog'
import { sampleFor, type Sample } from './fontSampleCache'
import {
  frameCenter,
  labelBoxSize,
  layoutOrigin,
  placeLabel,
  quantizeRotation,
  type Point,
} from './labelBox'
import { engineStrokeFor } from './textStyle'

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
export function rasterFor(
  text: string,
  style: TextStyle,
  phase: Point = NO_PHASE,
  rotation = 0,
): LabelRaster {
  if (text.length === 0) return NOTHING

  const faces = catalogByFamily.value.get(style.fontFamily)
  const entry = faces ? representativeOf(faces) : null
  // Nothing to say while the catalogue is still being enumerated: the family
  // is not missing yet, it is unanswered — and a box drawn on every start
  // would say the wrong one.
  if (!entry && !catalogLoaded.value) return NOTHING

  const req = {
    text,
    sizePx: style.fontSizePx,
    fillColor: style.color,
    stroke: engineStrokeFor(style),
    vertical: style.direction === 'vertical',
    align: style.align,
    weightPx: style.weightPx,
    rotation,
    phaseX: phase.x,
    phaseY: phase.y,
  }

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
 * ⚠️ It rasterizes up to three times on a fresh label and none ever after, all
 * of them landing on the sample cache. The passes answer different questions
 * and cannot be collapsed:
 *
 * 1. Upright and unphased — what the object's own size is. The frame measures
 *    this, so what you grab stays the object rather than the rectangle its
 *    turn happens to need.
 * 2. Turned and unphased — how big the bitmap that gets blitted is. The phase
 *    is derived from that, since that is the thing landing on the grid.
 * 3. Turned and phased — the bitmap to draw.
 *
 * At an angle of zero the first two are the same request, so an upright label
 * costs exactly what it did before: two entries, and the phase is quantised so
 * a drag adds a handful rather than one per frame.
 */
export function drawnLabel(
  text: string,
  style: TextStyle,
  at: Point,
  rotation = 0,
): DrawnLabel {
  const turn = quantizeRotation(rotation)

  const measured = rasterFor(text, style)
  const box = labelBoxSize(style, measured.sample?.image ?? null)
  // The turned bitmap holds the run at its own middle, so both rectangles share
  // one centre and the frame is the same point as the ink.
  const middle = frameCenter(at, box, layoutOrigin(style), turn)
  if (!measured.sample) return { ...measured, box, center: placeLabel(middle, box, turn).center }

  const spun = turn === 0 ? measured : rasterFor(text, style, NO_PHASE, turn)
  const blit = spun.sample
    ? { w: spun.sample.image.width, h: spun.sample.image.height }
    : box
  const { center, phase } = placeLabel(middle, blit, turn)
  return { ...rasterFor(text, style, phase, turn), box, center }
}
