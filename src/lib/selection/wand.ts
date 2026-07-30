import { EMPTY_RASTER, type ShapeRaster } from '@/lib/selection/raster'
import type { Point } from '@/lib/selection/rect'

/** Photoshop's own default, and the only value the first tools offer. */
export const DEFAULT_WAND_TOLERANCE = 32

/**
 * Everything of one colour reachable from where you clicked, sampled off the
 * raw page rather than off what is composited over it — the point of the wand
 * here is to catch a balloon's interior, and a translation sitting on top of it
 * is not part of the balloon.
 *
 * Contiguous, as Photoshop is by default: a flood rather than a colour range,
 * so clicking one balloon does not select every balloon on the page.
 *
 * Hard edged. A soft mask could hold a graded rim, but estimating coverage from
 * colour distance is a guess, and the ants read the 50% contour either way.
 */
export function magicWandRaster(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  seed: Point,
  tolerance = DEFAULT_WAND_TOLERANCE,
): ShapeRaster {
  const sx = Math.floor(seed.x)
  const sy = Math.floor(seed.y)
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return EMPTY_RASTER

  const at = (sy * w + sx) * 4
  const r0 = pixels[at]
  const g0 = pixels[at + 1]
  const b0 = pixels[at + 2]
  const matches = (x: number, y: number): boolean => {
    const i = (y * w + x) * 4
    return (
      Math.abs(pixels[i] - r0) <= tolerance &&
      Math.abs(pixels[i + 1] - g0) <= tolerance &&
      Math.abs(pixels[i + 2] - b0) <= tolerance
    )
  }

  const filled = new Uint8Array(w * h)
  let minX = sx
  let maxX = sx
  let minY = sy
  let maxY = sy

  // Scanline flood: each entry is one seed for a horizontal run, so the stack
  // grows with the number of runs rather than with the area — a page-sized fill
  // otherwise queues a pixel at a time and the stack outweighs the image.
  const stack: number[] = [sx, sy]
  while (stack.length > 0) {
    const y = stack.pop() as number
    const x = stack.pop() as number
    const row = y * w
    if (filled[row + x]) continue

    let left = x
    while (left > 0 && !filled[row + left - 1] && matches(left - 1, y)) left--
    let right = x
    while (right < w - 1 && !filled[row + right + 1] && matches(right + 1, y)) right++
    filled.fill(1, row + left, row + right + 1)

    if (left < minX) minX = left
    if (right > maxX) maxX = right
    if (y < minY) minY = y
    if (y > maxY) maxY = y

    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue
      const nrow = ny * w
      let i = left
      while (i <= right) {
        if (filled[nrow + i] || !matches(i, ny)) {
          i++
          continue
        }
        stack.push(i, ny)
        while (i <= right && !filled[nrow + i] && matches(i, ny)) i++
      }
    }
  }

  const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
  const coverage = new Uint8ClampedArray(bounds.w * bounds.h)
  for (let row = 0; row < bounds.h; row++) {
    const from = (bounds.y + row) * w + bounds.x
    for (let i = 0; i < bounds.w; i++) {
      if (filled[from + i]) coverage[row * bounds.w + i] = 255
    }
  }
  return { bounds, coverage }
}
