import type { TextStyle } from '@shared/text-style/types'
import { catalogByFamily, catalogLoaded } from './fontCatalog'
import { sampleFor, type Sample } from './fontSampleCache'
import { labelBoxSize, placeLabel, type Point } from './labelBox'
import { engineStrokeFor } from './textStyle'

export type LabelRaster = { ok: true; sample: Sample } | { ok: false; reason: string }

const NO_PHASE: Point = { x: 0, y: 0 }

/**
 * One label's bitmap. Shared because the frame is sized from what the text
 * actually came out as, and a frame that measured a second rasterization of its
 * own would be a mismatch waiting to happen. Reads module state rather than
 * taking it, so a caller inside a `computed` tracks the catalogue for free;
 * repeat calls land on the sample cache.
 *
 * A family that is not in the catalogue is reported, never quietly stood in
 * for. Nothing in this pipeline consults a second face, so drawing one would
 * show a result the application cannot produce (see ADR 0001).
 */
export function rasterFor(text: string, style: TextStyle, phase: Point = NO_PHASE): LabelRaster {
  if (text.length === 0) return { ok: false, reason: '' }

  const entry = catalogByFamily.value.get(style.fontFamily)
  if (!entry) {
    // Nothing to say while the catalogue is still being enumerated: the family
    // is not missing yet, it is unanswered.
    if (!catalogLoaded.value) return { ok: false, reason: '' }
    return { ok: false, reason: `找不到字型「${style.fontFamily}」` }
  }

  try {
    return {
      ok: true,
      sample: sampleFor({
        entry,
        text,
        sizePx: style.fontSizePx,
        fillColor: style.color,
        stroke: engineStrokeFor(style),
        vertical: style.direction === 'vertical',
        phaseX: phase.x,
        phaseY: phase.y,
      }),
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export interface DrawnLabel {
  /**
   * Null when there is nothing to draw — an empty label, or a family the
   * catalogue does not have. The frame still exists in both cases, which is
   * what keeps an empty label reachable instead of invisible.
   */
  sample: Sample | null
  /** Empty when there is simply no text, rather than something went wrong. */
  reason: string
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
  const box = labelBoxSize(style, measured.ok ? measured.sample.image : null)
  const { center, phase } = placeLabel(anchor, box)

  if (!measured.ok) return { sample: null, reason: measured.reason, box, center }
  const drawn = rasterFor(text, style, phase)
  if (!drawn.ok) return { sample: null, reason: drawn.reason, box, center }
  return { sample: drawn.sample, reason: '', box, center }
}
