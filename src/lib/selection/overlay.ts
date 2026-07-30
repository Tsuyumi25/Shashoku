import { contentToScreenPx, type ViewTransform } from '@/lib/coords'
import type { Point, Rect } from '@/lib/selection/rect'

/** Dash length in device pixels, so the crawl looks the same on any display. */
export const ANTS_DASH = 6

/**
 * Outlines in page coordinates as a path in device pixels.
 *
 * Built in device pixels under an identity transform rather than drawn under the
 * view transform, because a 1px stroke has to stay 1px at every zoom — scaling
 * the pen along with the page would give a hairline at 25% and a bar at 400%.
 * Each vertex lands on a whole device pixel plus a half, which is where a
 * one-pixel stroke covers exactly one row of pixels instead of two grey ones.
 *
 * Rotation comes through `contentToScreenPx` rather than being open-coded here:
 * a hand-rolled `tx + x * scale` is right until the first time the view turns.
 */
function appendRun(
  path: Path2D,
  points: readonly Point[],
  view: ViewTransform,
  dpr: number,
  close: boolean,
): void {
  for (let i = 0; i < points.length; i++) {
    const p = contentToScreenPx(points[i].x, points[i].y, view)
    const sx = Math.round(p.x * dpr) + 0.5
    const sy = Math.round(p.y * dpr) + 0.5
    if (i === 0) path.moveTo(sx, sy)
    else path.lineTo(sx, sy)
  }
  if (close) path.closePath()
}

export function antsPath(
  outlines: readonly (readonly Point[])[],
  view: ViewTransform,
  dpr: number,
): Path2D {
  const path = new Path2D()
  for (const loop of outlines) appendRun(path, loop, view, dpr, true)
  return path
}

/** An unfinished run of points, left open because it encloses nothing yet. */
export function openPath(points: readonly Point[], view: ViewTransform, dpr: number): Path2D {
  const path = new Path2D()
  appendRun(path, points, view, dpr, false)
  return path
}

/**
 * Black under white, so the ants are visible on a white balloon and on the dark
 * gutter around the page alike. Only the dash offset moves between frames, so
 * the crawl costs one number and a stroke.
 */
export function strokeAnts(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  phase: number,
): void {
  ctx.lineWidth = 1
  ctx.strokeStyle = '#000'
  ctx.setLineDash([])
  ctx.stroke(path)
  ctx.strokeStyle = '#fff'
  ctx.setLineDash([ANTS_DASH, ANTS_DASH])
  ctx.lineDashOffset = -phase
  ctx.stroke(path)
  ctx.setLineDash([])
  ctx.lineDashOffset = 0
}

/**
 * A line being drawn rather than a boundary that exists — the segments of a
 * polygon before it closes on anything.
 *
 * Solid, so the two never read as the same kind of thing: dashes mean "this is
 * the edge of a selection", and a solid line means "you are still placing this".
 * Haloed for the same reason the ants are, so it survives a white balloon and
 * the dark gutter alike.
 */
export function strokeBuildingPath(ctx: CanvasRenderingContext2D, path: Path2D): void {
  ctx.setLineDash([])
  ctx.lineWidth = 3
  ctx.strokeStyle = '#fff'
  ctx.stroke(path)
  ctx.lineWidth = 1
  ctx.strokeStyle = '#000'
  ctx.stroke(path)
}

/**
 * The mask itself as a red wash, at page resolution and only over its own
 * bounding box — a page-sized image would be rebuilt in full every time the
 * brush moved.
 *
 * Red marks what *is* selected, which is the opposite of Photoshop's default
 * and the same as its other setting. Here the mask being built is the thing
 * about to be erased, so showing it directly is what the person is looking at;
 * shading everything else instead would put the ink under the wash.
 */
export function quickMaskImage(
  mask: Uint8ClampedArray,
  pageWidth: number,
  bounds: Rect,
): OffscreenCanvas | null {
  const canvas = new OffscreenCanvas(bounds.w, bounds.h)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(bounds.w, bounds.h)
  const out = image.data
  for (let row = 0; row < bounds.h; row++) {
    const from = (bounds.y + row) * pageWidth + bounds.x
    for (let i = 0; i < bounds.w; i++) {
      const at = (row * bounds.w + i) * 4
      out[at] = 255
      // Half strength, as Quick Mask is, so the artwork stays readable under it.
      out[at + 3] = mask[from + i] >> 1
    }
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}
