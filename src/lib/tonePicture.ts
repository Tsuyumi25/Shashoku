import type { ToneEffect } from '@shared/effects/types'
import { toneInk } from '@shared/effects/tone'

/**
 * Where a picture's pixels fall on the sheet the dots are printed on: pixel
 * (i, j) has its centre at (`x0` + `ix`·i + `jx`·j, `y0` + `iy`·i + `jy`·j).
 * For a raster layer the sheet is the page; for a text object it is the
 * object's own unturned, unmirrored frame.
 */
export interface SheetGrid {
  x0: number
  y0: number
  ix: number
  iy: number
  jx: number
  jy: number
}

/** The page itself as the sheet, a picture's top-left pixel at (`x`, `y`). */
export function pageGrid(x: number, y: number): SheetGrid {
  return { x0: x + 0.5, y0: y + 0.5, ix: 1, iy: 0, jx: 0, jy: 1 }
}

/**
 * A label's bitmap where it lands: centred on `center`, turned by `spin` by
 * the engine and then mirrored in the page's axes as `mirror` says.
 */
export interface PlacedLabel {
  center: { x: number; y: number }
  mirror: { x: 1 | -1; y: 1 | -1 }
  spin: number
  width: number
  height: number
}

/**
 * The sheet stuck to a text object: each pixel's centre taken back through the
 * mirror and the turn into the object's own frame, measured from `origin` —
 * the point the object is stored at, which typing and resizing leave alone. So
 * moving, turning and flipping the object carry its dots along.
 *
 * The engine turns by R(spin) = [[cos, −sin], [sin, cos]] in the page's y-down
 * axes and the mirror comes after; undone, a page offset q from the centre is
 * R(−spin)·S·q in the frame.
 */
export function labelToneGrid(label: PlacedLabel, origin: { x: number; y: number }): SheetGrid {
  const { center, mirror, spin, width, height } = label
  const a = mirror.x * (center.x - origin.x) + 0.5 - width / 2
  const b = mirror.y * (center.y - origin.y) + 0.5 - height / 2
  const cos = Math.cos(spin)
  const sin = Math.sin(spin)
  return { x0: cos * a + sin * b, y0: -sin * a + cos * b, ix: cos, iy: -sin, jx: sin, jy: cos }
}

/**
 * The picture as a sheet of screentone film: black dots on clear, as much ink
 * at each pixel as the pixel would darken white paper — one less its
 * brightness, times its alpha — or the fixed density times the alpha. So a
 * soft brush's edge thins into smaller dots, white lays none, and whatever is
 * underneath shows between them.
 */
export function tonePicture(
  source: CanvasImageSource,
  width: number,
  height: number,
  grid: SheetGrid,
  tone: ToneEffect,
): OffscreenCanvas {
  const { canvas, ctx } = canvasOf(width, height)
  ctx.drawImage(source, 0, 0, width, height)
  const pixels = ctx.getImageData(0, 0, width, height)
  screenPixels(pixels.data, pixels.data, null, width, height, grid, tone)
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

/**
 * A label with its fill screened and its strokes left as they are. `whole` is
 * the label as drawn; `fill` is the same bitmap with only the fill's share,
 * which, the two being sums of premultiplied shares, leaves the strokes as the
 * difference.
 */
export function tonedLabel(
  whole: CanvasImageSource,
  fill: ImageData,
  grid: SheetGrid,
  tone: ToneEffect,
): OffscreenCanvas {
  const { width, height } = fill
  const { canvas, ctx } = canvasOf(width, height)
  ctx.drawImage(whole, 0, 0, width, height)
  const pixels = ctx.getImageData(0, 0, width, height)
  screenPixels(fill.data, pixels.data, pixels.data, width, height, grid, tone)
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

/**
 * `tonedLabel`, kept against the picture until the fill, where it lands or the
 * tone changes. A label's bitmap keeps its identity across repaints, so a page
 * that repaints every frame of a drag only re-screens what moved.
 */
export function tonedLabelHeld(
  whole: CanvasImageSource,
  fill: ImageData,
  grid: SheetGrid,
  tone: ToneEffect,
): OffscreenCanvas {
  const key = `${grid.x0},${grid.y0},${grid.ix},${grid.iy},${grid.jx},${grid.jy}|${tone.spacing}|${tone.angle}|${tone.density}`
  const held = heldByPicture.get(whole)
  if (held?.fill === fill && held.key === key) return held.picture
  const picture = tonedLabel(whole, fill, grid, tone)
  heldByPicture.set(whole, { fill, key, picture })
  return picture
}

const heldByPicture = new WeakMap<CanvasImageSource, { fill: ImageData; key: string; picture: OffscreenCanvas }>()

/**
 * Screens `ink` into `out`, straight RGBA both. With `over`, the dots go under
 * what is left of it once `ink`'s share is taken out; without, they are all
 * there is.
 */
export function screenPixels(
  ink: Uint8ClampedArray,
  out: Uint8ClampedArray,
  over: Uint8ClampedArray | null,
  width: number,
  height: number,
  grid: SheetGrid,
  tone: ToneEffect,
): void {
  const rad = (tone.angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const fixed = tone.density === 'image' ? null : tone.density / 100
  for (let j = 0; j < height; j++) {
    const rowX = grid.x0 + grid.jx * j
    const rowY = grid.y0 + grid.jy * j
    for (let i = 0; i < width; i++) {
      const at = (j * width + i) * 4
      const a = ink[at + 3]! / 255
      const r = ink[at]!
      const g = ink[at + 1]!
      const b = ink[at + 2]!
      const density = a === 0 ? 0 : (fixed ?? 1 - (0.299 * r + 0.587 * g + 0.114 * b) / 255) * a
      const dot =
        density === 0 ? 0 : toneInk(rowX + grid.ix * i, rowY + grid.iy * i, density, tone.spacing, cos, sin)
      if (over === null) {
        out[at] = 0
        out[at + 1] = 0
        out[at + 2] = 0
        out[at + 3] = Math.round(dot * 255)
        continue
      }
      const wa = over[at + 3]! / 255
      const sa = Math.max(0, wa - a)
      const sr = Math.max(0, over[at]! * wa - r * a)
      const sg = Math.max(0, over[at + 1]! * wa - g * a)
      const sb = Math.max(0, over[at + 2]! * wa - b * a)
      const oa = Math.min(1, sa + dot * (1 - sa))
      out[at] = oa === 0 ? 0 : sr / oa
      out[at + 1] = oa === 0 ? 0 : sg / oa
      out[at + 2] = oa === 0 ? 0 : sb / oa
      out[at + 3] = Math.round(oa * 255)
    }
  }
}

function canvasOf(width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  return { canvas, ctx }
}
