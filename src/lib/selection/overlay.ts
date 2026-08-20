import { contentToScreenPx, type ViewTransform } from '@/lib/coords'
import type { MaskWindow } from '@/lib/selection/mask'
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
 * The mask as a red wash, painted straight into a page-sized canvas at the page
 * coordinates it belongs to.
 *
 * Red marks what *is* selected, which is the opposite of Photoshop's default
 * and the same as its other setting. Here the mask being built is the thing
 * about to be erased, so showing it directly is what the person is looking at;
 * shading everything else instead would put the ink under the wash.
 *
 * Takes the region to paint rather than working it out, because a brush stamp
 * dirties a few thousand pixels while the selection it belongs to covers
 * millions: this loop costs about 60ms per megapixel, so repainting the whole
 * selection for one stamp was the whole of the stall it used to cause.
 * `putImageData` replaces rather than blends, which is what lets an erase
 * stroke patch the same way a paint stroke does.
 *
 * `at` is in page coordinates and must lie inside the window; the canvas is
 * page-sized, so what is painted lands where the mask says it is.
 */
export function paintMaskRegion(
  ctx: OffscreenCanvasRenderingContext2D,
  window: MaskWindow,
  at: Rect,
): void {
  if (at.w <= 0 || at.h <= 0) return
  const image = ctx.createImageData(at.w, at.h)
  const out = image.data
  for (let row = 0; row < at.h; row++) {
    const from = (at.y + row - window.region.y) * window.region.w + (at.x - window.region.x)
    for (let i = 0; i < at.w; i++) {
      const at4 = (row * at.w + i) * 4
      out[at4] = 255
      // Half strength, as Quick Mask is, so the artwork stays readable under it.
      out[at4 + 3] = window.bytes[from + i] >> 1
    }
  }
  ctx.putImageData(image, at.x, at.y)
}
