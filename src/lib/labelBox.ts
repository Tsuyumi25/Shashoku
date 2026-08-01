import type { TextStyle } from '@shared/text-style/types'

export interface Point {
  x: number
  y: number
}

/**
 * How big the frame around a label is, in document pixels.
 *
 * A bitmap pixel is a document pixel — the engine is asked for the size the
 * page wants, so nothing downstream resamples a label to fit its own frame.
 *
 * Typeset text is measured from what the engine actually rasterized, padding
 * included, so the frame is the extent of the drawn object rather than of its
 * glyphs — an outside stroke stays inside its own frame. An empty label has no
 * bitmap to measure and would otherwise have no frame at all, which is what
 * used to leave it invisible on the page; one line square is the only size it
 * can be said to have, and it states the size the text will come out at.
 */
export function labelBoxSize(
  style: TextStyle,
  bitmap: { width: number; height: number } | null,
): { w: number; h: number } {
  if (!bitmap) {
    const line = style.fontSizePx * (style.leadingPercent / 100)
    return { w: line, h: line }
  }
  return { w: bitmap.width, h: bitmap.height }
}

/**
 * How fine a phase the sample cache is willing to pay for, in page pixels.
 *
 * ⚠️ Not a property of the engine, which takes a real number, and not measured:
 * it is the constant that makes a fractional position affordable. The cache is
 * keyed on a whole run rather than on a glyph, so an unrounded phase means
 * rasterizing the entire line on every frame of a drag.
 */
const FINE_PHASE_STEP = 1 / 4

/** A whole step is a phase of zero: the run lands on the grid on that axis. */
const SNAPPED_PHASE_STEP = 1

/** Within this of a right angle still counts as one, in radians. */
const AXIS_TOLERANCE = 1e-3

/**
 * How fine an angle the sample cache is willing to pay for, in radians.
 *
 * The same trade as the phase, for the same reason: the cache is keyed on a
 * whole run, so an unrounded angle rasterizes the entire line on every frame
 * of a rotation. A quarter of a degree swings the end of a long label by about
 * a pixel, which is under what the gesture itself shows.
 *
 * A quarter turn stays exact under this, so the axis rule below still
 * recognises one.
 */
const ROTATION_STEP = Math.PI / 720

/** The angle as the sample cache will hold it. */
export function quantizeRotation(radians: number): number {
  return Math.round(radians / ROTATION_STEP) * ROTATION_STEP
}

/**
 * Which axis, if either, to snap the run onto the page grid.
 *
 * Snapping one axis keeps horizontal strokes and baselines whole, which is the
 * convention every text stack converges on and matters most in Chinese and
 * Japanese, where the horizontal stroke is everywhere and thin. The other axis
 * stays fractional so spacing lands where it was put.
 *
 * That rule carried an unstated premise: that the strokes in question lie
 * along a row. Turn the object and the premise stops holding, so the axis
 * follows the turn — a quarter turn stands those strokes up into columns, and
 * an angle off the axes aligns them with nothing, leaving neither axis worth
 * paying for. Snap whichever axis the strokes lie along, if any.
 */
function phaseStepFor(rotation: number): Point {
  const quarters = rotation / (Math.PI / 2)
  const nearest = Math.round(quarters)
  if (Math.abs(quarters - nearest) * (Math.PI / 2) > AXIS_TOLERANCE) {
    return { x: FINE_PHASE_STEP, y: FINE_PHASE_STEP }
  }
  // Even quarter turns leave rows lying along X; odd ones stand them up.
  return Math.abs(nearest) % 2 === 0
    ? { x: FINE_PHASE_STEP, y: SNAPPED_PHASE_STEP }
    : { x: SNAPPED_PHASE_STEP, y: FINE_PHASE_STEP }
}

export interface LabelPlacement {
  /**
   * Where to draw the box's centre so its corner lands on the grid. Within
   * half a phase step of the stored position and never written back.
   */
  center: Point
  /** What is left over, for the rasterizer to spend on coverage. */
  phase: Point
}

/**
 * Where a label's bitmap goes, split into the part the page grid can hold and
 * the part only a rasterizer can.
 *
 * ```
 * corner = anchor − box / 2
 *   ⌊corner⌋            where the bitmap is blitted — always an integer
 *   corner − ⌊corner⌋   the phase, handed to the engine
 * ```
 *
 * Both draw sites call this, and that is the whole of what it buys. The
 * correction is at most half a page pixel and nobody will see it; what matters
 * is that the same rule cannot produce two answers, so the preview and the
 * export are the same picture by construction rather than by luck. The same
 * three lines written out twice is exactly how this file's rasterizers came to
 * disagree about their filter.
 *
 * Recomputed at draw time and never stored, which is what answers the editing
 * case: typing changes `box.w`, and a correction held here moves nothing on
 * disk. A tool that re-snapped the stored coordinate would have it walk while
 * somebody types.
 *
 * `box` is whatever is actually going to be blitted, so a turned object hands
 * over the rectangle its turn needs rather than its own upright size. The
 * angle itself only decides which axis is worth snapping.
 */
export function placeLabel(
  anchor: Point,
  box: { w: number; h: number },
  rotation = 0,
): LabelPlacement {
  const step = phaseStepFor(rotation)
  const axis = (at: number, extent: number, step: number) => {
    const snapped = Math.round((at - extent / 2) / step) * step
    const blit = Math.floor(snapped)
    return { center: blit + extent / 2, phase: snapped - blit }
  }
  const x = axis(anchor.x, box.w, step.x)
  const y = axis(anchor.y, box.h, step.y)
  return { center: { x: x.center, y: y.center }, phase: { x: x.phase, y: y.phase } }
}

/**
 * What a corner drag may leave a label at, in document pixels. The floor keeps
 * a frame you can still find after dragging it down towards nothing; the
 * ceiling is there because the engine rasterizes at `fontSizePx`, so a slip of
 * the wrist would otherwise ask it for a bitmap the size of a wall.
 */
export const MIN_FONT_SIZE_PX = 2
export const MAX_FONT_SIZE_PX = 1000

/**
 * What a corner drag multiplies the object's size by: how far the pointer sits
 * from the centre now against where it started.
 *
 * Measured from the pointer rather than from the corner it grabbed so the ratio
 * opens at exactly 1 and the object does not jump on the first frame. Anchored
 * on the centre rather than on the opposite corner — which is what a page
 * layout tool would do — because a label's stored position is its centre, and
 * pinning the far corner would walk the text out of the bubble it was placed in.
 */
export function uniformScaleRatio(center: Point, from: Point, to: Point): number {
  const started = Math.hypot(from.x - center.x, from.y - center.y)
  if (started < 1e-6) return 1
  return Math.hypot(to.x - center.x, to.y - center.y) / started
}

/**
 * The short way round from one angle to another. atan2 reports a half-open
 * turn, so a drag stepping across the seam arrives as nearly a full turn the
 * other way; accumulating these instead of subtracting raw angles is what lets
 * a rotation pass 180 degrees and keep going.
 */
export function angleDelta(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

/** Where a point sits around a centre, for the drags that turn things. */
export function angleAround(center: Point, p: Point): number {
  return Math.atan2(p.y - center.y, p.x - center.x)
}
