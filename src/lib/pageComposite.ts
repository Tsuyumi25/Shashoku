import type { StyleGroup } from '@shared/project/types'
import type { TextStyle } from '@shared/text-style/types'
import type { LabelItem } from '@/types/project'
import { percentToContentPx } from '@/lib/coords'
import { labelBoxSize } from '@/lib/labelBox'
import { rasterFor } from '@/lib/labelRaster'
import { sampleSource } from '@/lib/fontSampleCache'
import { resolveTextStyle } from '@/lib/textStyle'

/**
 * A page that cannot be drawn faithfully. Never swallowed: the whole point of
 * looking at composited pages before an export is to find out that page 47 is
 * wrong, and a page quietly missing its text would say the opposite.
 */
export class CompositeError extends Error {}

export interface CompositeInput {
  /** The raw page as it sits in the project's own copy. */
  raw: Uint8Array
  labels: readonly LabelItem[]
  groups: readonly StyleGroup[]
  defaultStyle: TextStyle
}

/**
 * One page as it will be delivered: the raw with its typeset text burnt in, at
 * the raw's own size.
 *
 * Deliberately built from the same rasterizer, the same resolved style and the
 * same box geometry the canvas draws with, so what comes out of here matching
 * what is on screen is a property of the code rather than something anyone has
 * to keep true. Resizing is a separate step for the same reason — one clean
 * downsample of the finished page, rather than a second set of rules for where
 * text lands at another scale.
 */
export async function compositePage(input: CompositeInput): Promise<OffscreenCanvas> {
  const bitmap = await createImageBitmap(new Blob([input.raw as BlobPart]))
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new CompositeError('OffscreenCanvas 2d context unavailable')
    ctx.drawImage(bitmap, 0, 0)

    for (const label of input.labels) {
      if (label.text.length === 0) continue
      const style = resolveTextStyle(label, input.groups, input.defaultStyle)
      const raster = rasterFor(label.text, style)
      if (!raster.ok) {
        throw new CompositeError(raster.reason || `無法繪製標籤「${label.text}」`)
      }
      const size = labelBoxSize(style, raster.sample.image)
      const anchor = percentToContentPx(label.x, label.y, bitmap.width, bitmap.height)

      ctx.save()
      ctx.translate(anchor.x, anchor.y)
      ctx.rotate(label.rotation)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(sampleSource(raster.sample), -size.w / 2, -size.h / 2, size.w, size.h)
      ctx.restore()
    }

    return canvas
  } finally {
    bitmap.close()
  }
}

/** Longest edge fitted to `edge`, aspect kept. A page already smaller is left alone. */
export function fitWithin(
  size: { w: number; h: number },
  edge: number,
): { w: number; h: number } {
  const longest = Math.max(size.w, size.h)
  if (longest <= edge) return { w: size.w, h: size.h }
  const ratio = edge / longest
  return { w: Math.max(1, Math.round(size.w * ratio)), h: Math.max(1, Math.round(size.h * ratio)) }
}

export function resizeCanvas(source: OffscreenCanvas, w: number, h: number): OffscreenCanvas {
  if (source.width === w && source.height === h) return source
  const out = new OffscreenCanvas(w, h)
  const ctx = out.getContext('2d')
  if (!ctx) throw new CompositeError('OffscreenCanvas 2d context unavailable')
  ctx.imageSmoothingEnabled = true
  // Screentones and hairlines are exactly what a cheap downsample destroys, and
  // exactly what someone checking a page before delivery is looking at.
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return out
}
