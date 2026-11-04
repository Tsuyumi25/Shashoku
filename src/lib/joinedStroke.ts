import type { LayerEffect, StrokePosition } from '@shared/effects/types'
import { strokeOf, withStroke } from '@shared/effects/stroke'
import { sampleSource } from '@/lib/fontSampleCache'
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
export function withJoinedBands(
  own: DrawnLabel,
  ownLetters: DrawnLabel,
  position: StrokePosition,
  under: readonly DrawnLabel[],
): OffscreenCanvas | null {
  // An inside band never leaves its own letters, so there is nothing to keep off.
  if (position === 'inside') return null
  const at = cornerOf(own)
  const self = cornerOf(ownLetters)
  if (at === null || self === null || !own.sample || !ownLetters.sample) return null
  const reaching = under.filter((label) => {
    const r = cornerOf(label)
    return r !== null && r.x < at.x + at.w && at.x < r.x + r.w && r.y < at.y + at.h && at.y < r.y + r.h
  })
  if (reaching.length === 0) return null

  const solid = context2d(at.w, at.h)
  for (const label of reaching) {
    const r = cornerOf(label)
    if (r && label.sample) solid.drawImage(sampleSource(label.sample), r.x - at.x, r.y - at.y)
  }
  const coverage = solid.getImageData(0, 0, at.w, at.h)
  const px = coverage.data
  for (let i = 3; i < px.length; i += 4) px[i] = px[i]! >= SOLID ? 255 : 0
  solid.putImageData(coverage, 0, 0)

  // Inside its letters, an outside band is not there at all and a centred one
  // is: the letters alone are the first, the bitmap cut to the letters the
  // second.
  const inLetters = context2d(at.w, at.h)
  if (position === 'outside') {
    inLetters.drawImage(sampleSource(ownLetters.sample), self.x - at.x, self.y - at.y)
  } else {
    inLetters.drawImage(sampleSource(own.sample), 0, 0)
    inLetters.globalCompositeOperation = 'destination-in'
    inLetters.drawImage(sampleSource(ownLetters.sample), self.x - at.x, self.y - at.y)
  }
  inLetters.globalCompositeOperation = 'destination-in'
  inLetters.drawImage(solid.canvas, 0, 0)

  const out = context2d(at.w, at.h)
  out.drawImage(sampleSource(own.sample), 0, 0)
  out.globalCompositeOperation = 'destination-out'
  out.drawImage(solid.canvas, 0, 0)
  out.globalCompositeOperation = 'source-over'
  out.drawImage(inLetters.canvas, 0, 0)
  return out.canvas
}

/** The alpha a sample reaches only where it is fully covered, edge rounding allowed for. */
const SOLID = 254

function context2d(w: number, h: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(w, h).getContext('2d')
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable')
  return ctx
}
