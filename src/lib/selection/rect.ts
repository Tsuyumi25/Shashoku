/**
 * Integer pixel rectangles, in page pixels. A rect is half open — `x` to
 * `x + w` — so an empty one has `w` or `h` at zero and every operation below
 * treats it as "nothing", not as a point.
 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 }

export function isEmptyRect(r: Rect): boolean {
  return r.w <= 0 || r.h <= 0
}

/**
 * A float rect grown outward to whole pixels — every pixel the shape touches
 * at all. For a scan range, where including a pixel that turns out empty costs
 * nothing and missing one loses part of the shape.
 */
export function outsetToPixels(r: Rect): Rect {
  const x0 = Math.floor(r.x)
  const y0 = Math.floor(r.y)
  return { x: x0, y: y0, w: Math.ceil(r.x + r.w) - x0, h: Math.ceil(r.y + r.h) - y0 }
}

/**
 * A float rect snapped to the nearest pixel boundaries, which is what a
 * rectangular marquee does — it has no anti-aliasing to express a half-covered
 * edge with, so the edge has to land somewhere and the nearest boundary is the
 * one that follows the pointer.
 *
 * Deliberately not `outsetToPixels`: growing outward is right for a scan range
 * and wrong for a shape, because preview and commit would then disagree by up
 * to a pixel on each side wherever one rounded and the other did not.
 */
export function snapToPixels(r: Rect): Rect {
  const x0 = Math.round(r.x)
  const y0 = Math.round(r.y)
  return { x: x0, y: y0, w: Math.round(r.x + r.w) - x0, h: Math.round(r.y + r.h) - y0 }
}

/** Cut down to the page, keeping the rect integral. Never grows it. */
export function clampToPage(r: Rect, w: number, h: number): Rect {
  const x0 = Math.max(0, r.x)
  const y0 = Math.max(0, r.y)
  const x1 = Math.min(w, r.x + r.w)
  const y1 = Math.min(h, r.y + r.h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

export function unionRect(a: Rect, b: Rect): Rect {
  if (isEmptyRect(a)) return b
  if (isEmptyRect(b)) return a
  const x0 = Math.min(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const x1 = Math.max(a.x + a.w, b.x + b.w)
  const y1 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

export function intersectRect(a: Rect, b: Rect): Rect {
  const x0 = Math.max(a.x, b.x)
  const y0 = Math.max(a.y, b.y)
  const x1 = Math.min(a.x + a.w, b.x + b.w)
  const y1 = Math.min(a.y + a.h, b.y + b.h)
  if (x1 <= x0 || y1 <= y0) return EMPTY_RECT
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The rect two dragged corners describe, in either direction. */
export function rectBetween(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

/** Whether two rectangles describe the same box. */
export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}
