import {
  clampToPage,
  isEmptyRect,
  outsetToPixels,
  snapToPixels,
  type Point,
  type Rect,
} from '@/lib/selection/rect'

/**
 * A shape turned into coverage, held over its own bounding box rather than a
 * page — a lasso in one corner has no reason to carry a page of zeroes, and
 * every gesture rasterizes one of these on every frame.
 *
 * `coverage` is `bounds.w * bounds.h` bytes, 255 meaning the pixel is entirely
 * inside the shape. Partial values are real: a selection is a soft mask, so an
 * anti-aliased edge is expressible rather than something to round away.
 */
export interface ShapeRaster {
  bounds: Rect
  coverage: Uint8ClampedArray
}

export const EMPTY_RASTER: ShapeRaster = {
  bounds: { x: 0, y: 0, w: 0, h: 0 },
  coverage: new Uint8ClampedArray(0),
}

/**
 * Sub-scanlines per pixel row. Horizontal coverage within a sub-scanline is
 * exact, so this only sets how finely a near-horizontal edge is graded, and
 * four steps is past where the ants — which read the 50% contour and are
 * therefore whole pixels either way — could show a difference.
 */
const SUBSAMPLES = 4
const SUB_WEIGHT = 1 / SUBSAMPLES

/** Coverage of one horizontal span into a row accumulator, ends included. */
function addSpan(acc: Float32Array, xa: number, xb: number): void {
  const width = acc.length
  const a = Math.max(0, xa)
  const b = Math.min(width, xb)
  if (b <= a) return
  const i0 = Math.floor(a)
  const i1 = Math.floor(b)
  if (i0 === i1) {
    acc[i0] += (b - a) * SUB_WEIGHT
    return
  }
  acc[i0] += (i0 + 1 - a) * SUB_WEIGHT
  for (let i = i0 + 1; i < i1; i++) acc[i] += SUB_WEIGHT
  if (i1 < width) acc[i1] += (b - i1) * SUB_WEIGHT
}

function packRow(acc: Float32Array, out: Uint8ClampedArray, at: number): void {
  for (let i = 0; i < acc.length; i++) {
    out[at + i] = Math.round(acc[i] * 255)
    acc[i] = 0
  }
}

/**
 * A rectangular marquee. Hard edged and snapped to pixel boundaries, as in
 * Photoshop, where the rectangle is the one selection shape with no anti-alias
 * option — there is no half-covered edge to express.
 */
export function rasterizeRect(page: { w: number; h: number }, rect: Rect): ShapeRaster {
  const bounds = clampToPage(snapToPixels(rect), page.w, page.h)
  if (isEmptyRect(bounds)) return EMPTY_RASTER
  const coverage = new Uint8ClampedArray(bounds.w * bounds.h)
  coverage.fill(255)
  return { bounds, coverage }
}

/** An elliptical marquee inscribed in `rect`, anti-aliased. */
export function rasterizeEllipse(page: { w: number; h: number }, rect: Rect): ShapeRaster {
  const bounds = clampToPage(outsetToPixels(rect), page.w, page.h)
  if (isEmptyRect(bounds) || rect.w <= 0 || rect.h <= 0) return EMPTY_RASTER

  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const rx = rect.w / 2
  const ry = rect.h / 2

  const coverage = new Uint8ClampedArray(bounds.w * bounds.h)
  const acc = new Float32Array(bounds.w)
  for (let row = 0; row < bounds.h; row++) {
    for (let s = 0; s < SUBSAMPLES; s++) {
      const y = bounds.y + row + (s + 0.5) / SUBSAMPLES
      const dy = (y - cy) / ry
      if (dy <= -1 || dy >= 1) continue
      const dx = rx * Math.sqrt(1 - dy * dy)
      addSpan(acc, cx - dx - bounds.x, cx + dx - bounds.x)
    }
    packRow(acc, coverage, row * bounds.w)
  }
  return { bounds, coverage }
}

interface Edge {
  x0: number
  y0: number
  /** Reciprocal slope, so a crossing costs one multiply. */
  dxdy: number
  yMin: number
  yMax: number
  /** +1 when the edge runs downward, -1 upward — the winding contribution. */
  dir: 1 | -1
}

/**
 * A closed polygon, anti-aliased, filled by the non-zero winding rule — the
 * same rule `CanvasRenderingContext2D.fill` uses, so a lasso that crosses
 * itself selects what it looks like it selects rather than punching a hole.
 *
 * The path is closed with a straight segment from the last point back to the
 * first, which is what makes an unfinished lasso rasterizable at all: there is
 * always a region, so preview and commit can be the same call.
 */
export function rasterizePolygon(
  page: { w: number; h: number },
  points: readonly Point[],
): ShapeRaster {
  if (points.length < 3) return EMPTY_RASTER

  let minX = points[0].x
  let maxX = points[0].x
  let minY = points[0].y
  let maxY = points[0].y
  const edges: Edge[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (a.x < minX) minX = a.x
    if (a.x > maxX) maxX = a.x
    if (a.y < minY) minY = a.y
    if (a.y > maxY) maxY = a.y
    // A horizontal edge crosses no scanline, and its endpoints are already
    // carried by the two edges either side of it.
    if (a.y === b.y) continue
    edges.push({
      x0: a.x,
      y0: a.y,
      dxdy: (b.x - a.x) / (b.y - a.y),
      yMin: Math.min(a.y, b.y),
      yMax: Math.max(a.y, b.y),
      dir: b.y > a.y ? 1 : -1,
    })
  }
  if (edges.length === 0) return EMPTY_RASTER

  const bounds = clampToPage(
    outsetToPixels({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }),
    page.w,
    page.h,
  )
  if (isEmptyRect(bounds)) return EMPTY_RASTER

  // Sub-scanlines are visited in increasing y, so edges can be brought in once
  // and dropped once. Without this a long freehand lasso pays its whole point
  // count on every row of its bounding box, every frame.
  edges.sort((a, b) => a.yMin - b.yMin)
  let pending = 0
  let active: Edge[] = []

  const coverage = new Uint8ClampedArray(bounds.w * bounds.h)
  const acc = new Float32Array(bounds.w)
  const crossings: { x: number; dir: number }[] = []

  for (let row = 0; row < bounds.h; row++) {
    for (let s = 0; s < SUBSAMPLES; s++) {
      const y = bounds.y + row + (s + 0.5) / SUBSAMPLES
      while (pending < edges.length && edges[pending].yMin <= y) active.push(edges[pending++])
      if (active.length === 0) continue

      crossings.length = 0
      let live = 0
      for (const e of active) {
        if (e.yMax <= y) continue
        active[live++] = e
        crossings.push({ x: e.x0 + (y - e.y0) * e.dxdy, dir: e.dir })
      }
      if (live !== active.length) active = active.slice(0, live)
      if (crossings.length < 2) continue

      crossings.sort((a, b) => a.x - b.x)
      let winding = 0
      let spanStart = 0
      for (const c of crossings) {
        const was = winding
        winding += c.dir
        if (was === 0 && winding !== 0) spanStart = c.x
        else if (was !== 0 && winding === 0) addSpan(acc, spanStart - bounds.x, c.x - bounds.x)
      }
    }
    packRow(acc, coverage, row * bounds.w)
  }
  return { bounds, coverage }
}
