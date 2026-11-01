import { contentToScreenPx, type ViewTransform } from '@/lib/coords'
import type { MaskWindow } from '@/lib/selection/mask'
import type { Point, Rect } from '@/lib/selection/rect'

/**
 * Points in page coordinates as a path in device pixels.
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
function onDevicePixel(x: number, y: number, view: ViewTransform, dpr: number): Point {
  const p = contentToScreenPx(x, y, view)
  return { x: Math.round(p.x * dpr) + 0.5, y: Math.round(p.y * dpr) + 0.5 }
}

/** An unfinished run of points, left open because it encloses nothing yet. */
export function openPath(points: readonly Point[], view: ViewTransform, dpr: number): Path2D {
  const path = new Path2D()
  points.forEach((point, i) => {
    const p = onDevicePixel(point.x, point.y, view, dpr)
    if (i === 0) path.moveTo(p.x, p.y)
    else path.lineTo(p.x, p.y)
  })
  return path
}

/**
 * Boundary segments stroked one device pixel wide into a mask, which the ants
 * pattern then fills. Drawn once whenever the selection or the view moves, and
 * never again while the ants crawl.
 *
 * ⚠️ One open path for all of them and no `closePath`. Chromium's closePath
 * walks the whole path built so far, so closing each of the thousands of loops
 * in a screentone selection cost most of a second; a segment has nothing to
 * close.
 */
export function strokeSegments(
  ctx: OffscreenCanvasRenderingContext2D,
  segments: Int32Array,
  view: ViewTransform,
  dpr: number,
): void {
  // A plain copy, because the view is reactive and a page of screentone reads
  // it a few hundred thousand times: through the proxy that was most of a zoom step.
  const at: ViewTransform = { ...view }
  ctx.beginPath()
  for (let i = 0; i < segments.length; i += 4) {
    const a = onDevicePixel(segments[i]!, segments[i + 1]!, at, dpr)
    const b = onDevicePixel(segments[i + 2]!, segments[i + 3]!, at, dpr)
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
  }
  ctx.lineWidth = 1
  ctx.strokeStyle = '#fff'
  ctx.stroke()
}

/** How many steps one stripe takes to come round, and the stripe's period in device pixels. */
export const ANTS_PHASES = 8

/**
 * The ants as screen-fixed diagonal stripes, black and white, moving down and
 * to the right as the phase grows — what Photoshop, GIMP and Aseprite draw. A
 * pixel is white when `(x + y - phase) mod 8` is past half, which is GIMP's rule
 * with the phase turned round so the stripes travel the way Photoshop's do.
 * Black under white means the ants show on a white balloon and on the dark
 * gutter around the page alike.
 */
export function antsTile(phase: number): OffscreenCanvas {
  const tile = new OffscreenCanvas(ANTS_PHASES, ANTS_PHASES)
  const ctx = tile.getContext('2d')!
  const image = ctx.createImageData(ANTS_PHASES, ANTS_PHASES)
  for (let y = 0; y < ANTS_PHASES; y++) {
    for (let x = 0; x < ANTS_PHASES; x++) {
      const white = (((x + y - phase) % ANTS_PHASES) + ANTS_PHASES) % ANTS_PHASES >= ANTS_PHASES / 2
      const at = (y * ANTS_PHASES + x) * 4
      image.data[at] = image.data[at + 1] = image.data[at + 2] = white ? 255 : 0
      image.data[at + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  return tile
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
