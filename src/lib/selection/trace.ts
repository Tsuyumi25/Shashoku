import { ANTS_THRESHOLD } from '@/lib/selection/mask'
import type { Rect } from '@/lib/selection/rect'

/**
 * A selection mask's boundary as straight horizontal and vertical segments, for
 * the marching ants — four numbers each, `x0 y0 x1 y1`, on pixel corners.
 *
 * One pass over the region: a pixel edge is boundary where the pixels on its
 * two sides disagree, and a run of such edges along one row or column is one
 * segment. Nothing is walked into loops. The ants are drawn into a mask and
 * patterned there, so a segment never needs to know which way round it goes,
 * which side is inside, or what it joins — and an outline that is never closed
 * cannot cost a `closePath` per speck, which on a page of screentone was most
 * of a second.
 *
 * Diagonal neighbours do not touch: two pixels meeting at a corner get four
 * edges each, as in Photoshop and Clip Studio.
 *
 * `bounds` is the region to scan and must contain the whole selection —
 * anything outside it reads as unselected. Inside is the 50% contour, which is
 * where Photoshop puts the ants on a feathered edge.
 */
export function traceMaskSegments(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  bounds: Rect,
): Int32Array {
  const x0 = Math.max(0, bounds.x)
  const y0 = Math.max(0, bounds.y)
  const x1 = Math.min(w, bounds.x + bounds.w)
  const y1 = Math.min(h, bounds.y + bounds.h)
  if (x1 <= x0 || y1 <= y0) return new Int32Array(0)
  const inside = (x: number, y: number): boolean =>
    x >= x0 && y >= y0 && x < x1 && y < y1 && mask[y * w + x] >= ANTS_THRESHOLD

  const out: number[] = []
  // Vertical runs are built row by row, one open run per column boundary, so
  // the mask is still read in the order it is laid out.
  const openSince = new Int32Array(x1 - x0 + 1).fill(-1)

  for (let y = y0; y <= y1; y++) {
    // The boundary above row y, between it and the row before.
    let runFrom = -1
    for (let x = x0; x <= x1; x++) {
      const edge = x < x1 && inside(x, y - 1) !== inside(x, y)
      if (edge && runFrom < 0) runFrom = x
      else if (!edge && runFrom >= 0) {
        out.push(runFrom, y, x, y)
        runFrom = -1
      }
    }
    if (y === y1) break
    // The boundaries to the left of each pixel in row y.
    for (let x = x0; x <= x1; x++) {
      const at = x - x0
      const edge = inside(x - 1, y) !== inside(x, y)
      if (edge && openSince[at] < 0) openSince[at] = y
      else if (!edge && openSince[at] >= 0) {
        out.push(x, openSince[at], x, y)
        openSince[at] = -1
      }
    }
  }
  for (let at = 0; at < openSince.length; at++) {
    if (openSince[at] >= 0) out.push(x0 + at, openSince[at], x0 + at, y1)
  }
  return Int32Array.from(out)
}

/** The same segments moved by an offset, as from a mask's own pixels to the page's. */
export function offsetSegments(segments: Int32Array, dx: number, dy: number): Int32Array {
  const out = new Int32Array(segments.length)
  for (let i = 0; i < segments.length; i += 2) {
    out[i] = segments[i] + dx
    out[i + 1] = segments[i + 1] + dy
  }
  return out
}
