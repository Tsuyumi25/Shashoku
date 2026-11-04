import type { LayerEffect } from '@shared/effects/types'
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
 * A text object's bitmap with its band taken off the letters of the objects
 * under it it joins, or null when its band reaches none of them and the bitmap
 * draws as it is.
 *
 * Taken off its own copy rather than drawn under the others: what lies between
 * the two in the stack stays where the tree put it, because the only thing that
 * changes is how far this one's band reaches.
 */
export function withJoinedBands(
  own: DrawnLabel,
  ownLetters: DrawnLabel,
  under: readonly DrawnLabel[],
): OffscreenCanvas | null {
  const at = cornerOf(own)
  const self = cornerOf(ownLetters)
  if (at === null || self === null || !own.sample || !ownLetters.sample) return null
  const reaching = under.filter((label) => {
    const r = cornerOf(label)
    return r !== null && r.x < at.x + at.w && at.x < r.x + r.w && r.y < at.y + at.h && at.y < r.y + r.h
  })
  if (reaching.length === 0) return null

  const mask = new OffscreenCanvas(at.w, at.h)
  const m = mask.getContext('2d')
  if (!m) throw new Error('OffscreenCanvas 2d context unavailable')
  for (const label of reaching) {
    const r = cornerOf(label)
    if (r && label.sample) m.drawImage(sampleSource(label.sample), r.x - at.x, r.y - at.y)
  }
  m.globalCompositeOperation = 'destination-out'
  m.drawImage(sampleSource(ownLetters.sample), self.x - at.x, self.y - at.y)

  const out = new OffscreenCanvas(at.w, at.h)
  const o = out.getContext('2d')
  if (!o) throw new Error('OffscreenCanvas 2d context unavailable')
  o.drawImage(sampleSource(own.sample), 0, 0)
  o.globalCompositeOperation = 'destination-out'
  o.drawImage(mask, 0, 0)
  return out
}
