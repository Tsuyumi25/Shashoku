import type { Point, Rect } from '@/lib/selection/rect'

/** A frame that has been turned: a centre, a size, and an angle in radians. */
export interface Obb {
  center: Point
  w: number
  h: number
  rotation: number
}

function cornersOf(box: Obb): Point[] {
  const cos = Math.cos(box.rotation)
  const sin = Math.sin(box.rotation)
  const hx = box.w / 2
  const hy = box.h / 2
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([x, y]) => ({
    x: box.center.x + x * cos - y * sin,
    y: box.center.y + x * sin + y * cos,
  }))
}

function rectCorners(rect: Rect): Point[] {
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ]
}

function overlapsOn(axis: Point, a: readonly Point[], b: readonly Point[]): boolean {
  let aMin = Infinity
  let aMax = -Infinity
  let bMin = Infinity
  let bMax = -Infinity
  for (const p of a) {
    const d = p.x * axis.x + p.y * axis.y
    aMin = Math.min(aMin, d)
    aMax = Math.max(aMax, d)
  }
  for (const p of b) {
    const d = p.x * axis.x + p.y * axis.y
    bMin = Math.min(bMin, d)
    bMax = Math.max(bMax, d)
  }
  // Touching counts: an object the marquee's edge grazes is one the hand was
  // reaching for, and refusing it would make the boundary a place where nothing
  // can be picked.
  return aMin <= bMax && bMin <= aMax
}

/**
 * Whether a turned frame and an upright rectangle touch at all — the
 * separating-axis test, which for two rectangles needs only their four edge
 * normals.
 *
 * Exact rather than the usual upright-bounds approximation. A long label turned
 * 45° has upright bounds far larger than the label, and a marquee near one of
 * those corners would sweep in an object whose ink it never came near — the
 * kind of wrong that is only noticed after the batch operation has run.
 */
export function obbIntersectsRect(box: Obb, rect: Rect): boolean {
  const a = cornersOf(box)
  const b = rectCorners(rect)
  const cos = Math.cos(box.rotation)
  const sin = Math.sin(box.rotation)
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: cos, y: sin },
    { x: -sin, y: cos },
  ]
  return axes.every((axis) => overlapsOn(axis, a, b))
}

/**
 * Whether a turned frame holds a point — what says which object a click on the
 * page landed on.
 *
 * Measured in the frame's own axes rather than against its upright bounds: a
 * long object lying at 45° has bounds far larger than the object, and a click
 * near one of those corners would land on something it never touched.
 */
export function obbHoldsPoint(box: Obb, p: Point): boolean {
  const cos = Math.cos(box.rotation)
  const sin = Math.sin(box.rotation)
  const dx = p.x - box.center.x
  const dy = p.y - box.center.y
  // The inverse turn, written out rather than negating the angle, so this and
  // `cornersOf` above read as one another's opposite.
  const local = { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
  return Math.abs(local.x) <= box.w / 2 && Math.abs(local.y) <= box.h / 2
}
