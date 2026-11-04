import type { LayerEffect, StrokePosition } from '@shared/effects/types'
import { strokeOf, withStroke } from '@shared/effects/stroke'
import type { DrawnLabel } from '@/lib/labelRaster'

/**
 * The effects that draw a text object's letters alone, at exactly the place
 * its stroked bitmap lands.
 *
 * The stroke is kept at its width and made transparent rather than dropped:
 * the margin the bitmap is drawn with follows the width, and with it the frame
 * and the phase — so a bitmap without the stroke would sit a fraction off the
 * one with it. Moved outside so that nothing is eroded: an inside band is
 * drawn over the object's own letters, and those letters still cover what is
 * under them.
 */
export function lettersOnly(effects: readonly LayerEffect[]): LayerEffect[] {
  const stroke = strokeOf(effects)
  if (stroke === null) return [...effects]
  return withStroke(effects, { kind: 'stroke', width: stroke.width, color: '#00000000', position: 'outside' })
}

function cornerOf(label: DrawnLabel): { x: number; y: number; w: number; h: number } | null {
  if (!label.sample) return null
  const { width: w, height: h } = label.sample.image
  return { x: label.center.x - w / 2, y: label.center.y - h / 2, w, h }
}

/**
 * A text object's bitmap with its band kept off the letters of the objects
 * under it it joins, or null when it draws as it is.
 *
 * Changed in its own copy rather than drawn under the others: what lies between
 * the two in the stack stays where the tree put it, because the only thing that
 * changes is how far this one's band reaches.
 *
 * Wherever an object under it is solid — its letters, or its band of this same
 * colour — the bitmap is swapped for this object as it looks inside its own
 * letters, and left alone everywhere else. Solid and nothing else, because a
 * coverage is not a transparency: erasing by the alpha of an antialiased edge
 * takes the band off the half of the pixel the letter does not cover too, and
 * the band's colour shows as a fringe along every letter it meets. Under a solid
 * pixel of the same colour, a band laid or not is the same picture, so the swap
 * has no edge to show.
 *
 * `under` is the objects as drawn, band and all.
 */
export function joinedPixels(
  own: DrawnLabel,
  ownLetters: DrawnLabel,
  position: StrokePosition,
  under: readonly DrawnLabel[],
): ImageData | null {
  // An inside band never leaves its own letters, so there is nothing to keep off.
  if (position === 'inside') return null
  const at = cornerOf(own)
  const self = cornerOf(ownLetters)
  if (at === null || self === null || !own.sample || !ownLetters.sample) return null

  const { w, h } = at
  const solid = new Uint8Array(w * h)
  let any = false
  for (const label of under) {
    const r = cornerOf(label)
    if (r === null || !label.sample) continue
    const dx = Math.round(r.x - at.x)
    const dy = Math.round(r.y - at.y)
    const x0 = Math.max(0, dx)
    const y0 = Math.max(0, dy)
    const x1 = Math.min(w, dx + r.w)
    const y1 = Math.min(h, dy + r.h)
    const px = label.sample.image.data
    for (let y = y0; y < y1; y++) {
      const from = (y - dy) * r.w - dx
      for (let x = x0; x < x1; x++) {
        if (px[(from + x) * 4 + 3]! < SOLID) continue
        solid[y * w + x] = 1
        any = true
      }
    }
  }
  if (!any) return null

  // Inside its letters, an outside band is not there at all and a centred one
  // is: the letters alone are the first, the bitmap cut to the letters the
  // second.
  const src = own.sample.image.data
  const letters = ownLetters.sample.image.data
  const lw = self.w
  const lx = Math.round(self.x - at.x)
  const ly = Math.round(self.y - at.y)
  const out = new ImageData(new Uint8ClampedArray(src), w, h)
  const dst = out.data
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (solid[i] === 0) continue
      const sx = x - lx
      const sy = y - ly
      const j = sx >= 0 && sx < lw && sy >= 0 && sy < self.h ? (sy * lw + sx) * 4 : -1
      const a = j < 0 ? 0 : letters[j + 3]!
      const o = i * 4
      if (position === 'outside') {
        dst[o] = j < 0 ? 0 : letters[j]!
        dst[o + 1] = j < 0 ? 0 : letters[j + 1]!
        dst[o + 2] = j < 0 ? 0 : letters[j + 2]!
        dst[o + 3] = a
      } else {
        dst[o + 3] = Math.round((src[o + 3]! * a) / 255)
      }
    }
  }
  return out
}

/** `joinedPixels` on a canvas, ready to draw. */
export function withJoinedBands(
  own: DrawnLabel,
  ownLetters: DrawnLabel,
  position: StrokePosition,
  under: readonly DrawnLabel[],
): OffscreenCanvas | null {
  const pixels = joinedPixels(own, ownLetters, position, under)
  if (pixels === null) return null
  const canvas = new OffscreenCanvas(pixels.width, pixels.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  ctx.putImageData(pixels, 0, 0)
  return canvas
}

/** The alpha a sample reaches only where it is fully covered, edge rounding allowed for. */
const SOLID = 254
