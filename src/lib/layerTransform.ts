import type { Rect } from '@/lib/selection/rect'

/**
 * A gesture in progress on a raster layer, in the page's own units and
 * deliberately fractional. Nothing here has been written: it is what the canvas
 * previews with and what the bake is finally handed.
 */
export interface LayerPlacement {
  /** Travel, in page pixels. */
  dx: number
  dy: number
  /** Uniform, because one corner cannot mean two things — see decision 6. */
  scale: number
  /** Clockwise, in radians. */
  rotation: number
}

export const NO_PLACEMENT: LayerPlacement = { dx: 0, dy: 0, scale: 1, rotation: 0 }

/**
 * Where a raster layer's pixels are and which file holds them. The two travel
 * together because a turn writes a new file for a new frame, and either one put
 * back without the other would describe pixels that are not there.
 */
export interface LayerPlace extends Rect {
  file: string
}

export function isMoved(place: LayerPlacement): boolean {
  return place.dx !== 0 || place.dy !== 0 || place.scale !== 1 || place.rotation !== 0
}

/** The point a placement turns and scales around: the frame's own middle. */
export function frameCenter(frame: Rect): { x: number; y: number } {
  return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
}

/**
 * Rounding up has to survive a sine that should have been zero. At a quarter
 * turn `Math.cos` returns 6.1e-17 rather than 0, which `Math.ceil` would turn
 * into a whole pixel of transparent margin — on the very angles that are pure
 * pixel permutations and are supposed to cost nothing.
 */
function ceilPixels(span: number): number {
  return Math.ceil(span - 1e-9)
}

/**
 * The box a placed frame lands in, in whole page pixels.
 *
 * Axis aligned, because a layer's frame is what `drawImage` is given and that
 * takes a rectangle. A turned rectangle cannot be held by an upright one
 * without gaining transparent corners, so this box grows on every quarter turn
 * and never shrinks back — which is what scanning the alpha afterwards is for.
 *
 * The size is rounded up and the corner to the nearest pixel, so the content
 * cannot land half a pixel outside the box that is about to be written for it.
 */
export function placedFrame(frame: Rect, place: LayerPlacement): Rect {
  const center = frameCenter(frame)
  const cos = Math.abs(Math.cos(place.rotation))
  const sin = Math.abs(Math.sin(place.rotation))
  const w = frame.w * place.scale
  const h = frame.h * place.scale
  const spanW = ceilPixels(w * cos + h * sin)
  const spanH = ceilPixels(w * sin + h * cos)
  return {
    x: Math.round(center.x + place.dx - spanW / 2),
    y: Math.round(center.y + place.dy - spanH / 2),
    w: spanW,
    h: spanH,
  }
}

/**
 * How much alpha a pixel needs before it counts as content.
 *
 * Zero, which is the only value that provably cannot eat a real edge: a pixel
 * at alpha 0 contributes nothing to any composite it takes part in, so
 * dropping it changes no picture anywhere. Antialiasing leaves a ramp of 1, 2,
 * 3 around every turned edge, and a threshold high enough to reclaim those is
 * a threshold high enough to shave coverage off the artwork — a trade that
 * wants a measurement behind it, not an argument. This is also the rule Krita
 * uses when it writes OpenRaster.
 */
const CONTENT_ALPHA = 0

/**
 * The box the pixels actually occupy, or null if none of them do.
 *
 * A turned rectangle cannot be held by an upright box without gaining
 * transparent corners, and turning back does not give them up — so a frame
 * left at its geometric size only ever grows. Since the resample has already
 * walked every pixel, finding the real extents costs one more pass over
 * memory that is still warm.
 */
export function contentBounds(rgba: Uint8ClampedArray, w: number, h: number): Rect | null {
  let top = h
  let left = w
  let right = -1
  let bottom = -1
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (rgba[(y * w + x) * 4 + 3] <= CONTENT_ALPHA) continue
      if (y < top) top = y
      if (y > bottom) bottom = y
      if (x < left) left = x
      if (x > right) right = x
    }
  }
  if (right < 0) return null
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
}

/**
 * Put a context where a placed layer's own top-left corner is the origin, so
 * whatever is drawn next lands as the placement asks.
 *
 * `into` is where the pixels are being written — the new frame when baking, the
 * page itself when previewing — and the difference between the two is the only
 * thing that separates the two callers.
 */
export function applyPlacement(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: Rect,
  place: LayerPlacement,
  into: { x: number; y: number },
): void {
  const center = frameCenter(frame)
  ctx.translate(center.x + place.dx - into.x, center.y + place.dy - into.y)
  ctx.rotate(place.rotation)
  ctx.scale(place.scale, place.scale)
  ctx.translate(-frame.w / 2, -frame.h / 2)
}
