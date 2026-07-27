import type { TextStyle } from '@shared/text-style/types'

export interface Point {
  x: number
  y: number
}

/**
 * How big the frame around a label is, in document pixels.
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
  return { w: bitmap.width / style.renderScale, h: bitmap.height / style.renderScale }
}

/**
 * What a corner drag may leave a label at, in document pixels. The floor keeps
 * a frame you can still find after dragging it down towards nothing; the
 * ceiling is there because the engine rasterizes at `fontSizePx * renderScale`,
 * so a slip of the wrist would otherwise ask it for a bitmap the size of a wall.
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
