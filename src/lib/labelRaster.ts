import type { TextStyle } from '@shared/text-style/types'
import { catalogByFamily, catalogLoaded } from './fontCatalog'
import { sampleFor, type Sample } from './fontSampleCache'
import { labelBoxSize, placeLabel, type Point } from './labelBox'
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
   * it — absent from the catalogue, or present but undrawable. The object is
   * drawn either way; this is what says the drawing is a stand-in. Held as the
   * name rather than as a message so the interface can word it.
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
export function rasterFor(text: string, style: TextStyle, phase: Point = NO_PHASE): LabelRaster {
  if (text.length === 0) return NOTHING

  const entry = catalogByFamily.value.get(style.fontFamily) ?? null
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

export interface DrawnLabel {
  /**
   * Null when there is nothing to draw — an empty label, or a catalogue that
   * has not answered yet. The frame still exists in both cases, which is what
   * keeps an empty label reachable instead of invisible.
   */
  sample: Sample | null
  /** Set when what got drawn is a notdef box rather than the object's text. */
  missingFamily: string | null
  box: { w: number; h: number }
  center: Point
}

/**
 * One label, ready to draw: the bitmap, the frame around it, and where to put
 * that frame so the bitmap's corner lands on the page's own grid.
 *
 * Every surface that draws a label goes through here, which is the point. What
 * the canvas shows matching what exports is then a property of there being one
 * answer rather than a hope that two draw sites keep computing the same one.
 *
 * ⚠️ It rasterizes twice on a fresh label and once ever after. The frame is
 * measured from the bitmap and the phase is derived from the frame, so the
 * first pass is the measurement — which is sound because the phase moves the
 * run *inside* a bitmap whose size comes from the font's metrics and does not
 * follow it. Both passes land on the sample cache, and the phase is quantised,
 * so a label costs a handful of entries rather than one per frame of a drag.
 */
export function drawnLabel(text: string, style: TextStyle, anchor: Point): DrawnLabel {
  const measured = rasterFor(text, style)
  const box = labelBoxSize(style, measured.sample?.image ?? null)
  const { center, phase } = placeLabel(anchor, box)

  if (!measured.sample) return { ...measured, box, center }
  return { ...rasterFor(text, style, phase), box, center }
}
