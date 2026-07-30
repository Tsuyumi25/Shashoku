import { EMPTY_RECT, intersectRect, isEmptyRect, unionRect, type Rect } from '@/lib/selection/rect'
import type { ShapeRaster } from '@/lib/selection/raster'

/**
 * A selection is a full-page 8-bit soft mask, exactly as in Photoshop: 255 is
 * wholly selected, 0 is not selected at all, and everything between is real.
 * Every consumer multiplies its own strength by `mask/255` rather than clipping,
 * which is what makes a feathered or anti-aliased edge mean anything.
 *
 * Nothing here is reactive and nothing here is stored. A mask is editor state
 * that dies with the project, and a `Uint8ClampedArray` handed to `reactive()`
 * comes back unwrapped and unwatched without a warning, so it must never be
 * mistaken for something Vue is tracking.
 */

/** What a gesture does to the selection already on the page. */
export type SelectionOp = 'new' | 'add' | 'subtract' | 'intersect'

/** Which page a mask belongs to, and how big that page is. */
export interface MaskTarget {
  page: string
  w: number
  h: number
}

/** The 50% contour, which is where Photoshop draws the marching ants. */
export const ANTS_THRESHOLD = 128

export function fullMask(w: number, h: number): Uint8ClampedArray {
  const mask = new Uint8ClampedArray(w * h)
  mask.fill(255)
  return mask
}

/**
 * The bounding box of everything selected, or null when nothing is.
 *
 * `scan` narrows the search to a region already known to contain the result —
 * an operation's own changed region unioned with the previous bounds is always
 * such a region, and scanning a whole page to find out that a rectangle moved
 * by ten pixels is the difference between a command that is free and one that
 * is felt.
 */
export function boundsOfMask(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  scan?: Rect,
): Rect | null {
  const region = scan ?? { x: 0, y: 0, w, h }
  const x1 = Math.min(w, region.x + region.w)
  const y1 = Math.min(h, region.y + region.h)
  let minX = x1
  let minY = y1
  let maxX = -1
  let maxY = -1
  for (let y = Math.max(0, region.y); y < y1; y++) {
    const row = y * w
    for (let x = Math.max(0, region.x); x < x1; x++) {
      if (mask[row + x] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * Which pixels an operation can possibly change, worked out from the two
 * bounding boxes rather than by comparing before and after.
 *
 * This is what a command records, so it is also what undo needs to be exact
 * about: too small loses pixels, while too large only costs bytes. `new` is the
 * union because the old selection has to be cleared wherever the new shape does
 * not reach it.
 */
export function regionFor(op: SelectionOp, current: Rect | null, shape: Rect): Rect {
  const held = current ?? EMPTY_RECT
  switch (op) {
    case 'new':
      return unionRect(held, shape)
    case 'add':
      return shape
    case 'subtract':
      return intersectRect(held, shape)
    case 'intersect':
      return held
  }
}

/**
 * With nothing selected yet, adding and intersecting are both just selecting,
 * and subtracting has nothing to take from. Photoshop refuses the last one
 * outright; refusing it silently is the same result with less ceremony.
 */
export function normalizeOp(op: SelectionOp, current: Rect | null): SelectionOp | null {
  if (current !== null) return op
  return op === 'subtract' ? null : 'new'
}

/**
 * The one place a shape meets a selection. Preview and commit both come through
 * here — preview writing into a scratch page and commit writing into the live
 * one — which is why what is drawn during a drag cannot disagree with what the
 * release leaves behind.
 *
 * `region` is the span of pixels to write, and may be wider than the operation
 * strictly needs: a preview has to re-derive whatever the previous frame
 * dirtied, and every pixel here is computed from `base` and the shape alone, so
 * a wider region is more work and never a different answer.
 */
export function composeInto(
  dst: Uint8ClampedArray,
  base: Uint8ClampedArray | null,
  w: number,
  h: number,
  shape: ShapeRaster,
  op: SelectionOp,
  region: Rect,
): void {
  const x0 = Math.max(0, region.x)
  const y0 = Math.max(0, region.y)
  const x1 = Math.min(w, region.x + region.w)
  const y1 = Math.min(h, region.y + region.h)
  const sb = shape.bounds

  for (let y = y0; y < y1; y++) {
    const row = y * w
    const inShapeRow = y >= sb.y && y < sb.y + sb.h
    const shapeRow = inShapeRow ? (y - sb.y) * sb.w - sb.x : 0
    for (let x = x0; x < x1; x++) {
      const b = base === null ? 0 : base[row + x]
      const s = inShapeRow && x >= sb.x && x < sb.x + sb.w ? shape.coverage[shapeRow + x] : 0
      let out: number
      switch (op) {
        case 'new':
          out = s
          break
        case 'add':
          out = b > s ? b : s
          break
        case 'subtract':
          out = b - s
          break
        case 'intersect':
          out = b < s ? b : s
          break
      }
      dst[row + x] = out
    }
  }
}

/** Every value in a mask inverted, feathered edges included. */
export function invertInto(dst: Uint8ClampedArray, src: Uint8ClampedArray | null): void {
  if (src === null) {
    dst.fill(255)
    return
  }
  for (let i = 0; i < dst.length; i++) dst[i] = 255 - src[i]
}

/**
 * The bytes inside a region, laid out row by row — what a command holds so it
 * can put them back. A whole page is never copied: a selection command records
 * the box it touched, so undoing a rectangle dragged in one corner costs that
 * corner.
 */
export function readPatch(mask: Uint8ClampedArray, w: number, region: Rect): Uint8ClampedArray {
  if (isEmptyRect(region)) return new Uint8ClampedArray(0)
  const out = new Uint8ClampedArray(region.w * region.h)
  for (let row = 0; row < region.h; row++) {
    const from = (region.y + row) * w + region.x
    out.set(mask.subarray(from, from + region.w), row * region.w)
  }
  return out
}

export function writePatch(
  mask: Uint8ClampedArray,
  w: number,
  region: Rect,
  bytes: Uint8ClampedArray,
): void {
  if (isEmptyRect(region)) return
  for (let row = 0; row < region.h; row++) {
    mask.set(
      bytes.subarray(row * region.w, row * region.w + region.w),
      (region.y + row) * w + region.x,
    )
  }
}
