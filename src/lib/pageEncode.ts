import type { ExportProfile } from '@shared/export/types'
import { targetSize } from '@shared/export/profile'
import { resizeCanvas } from '@/lib/pageComposite'

export class EncodeError extends Error {}

/**
 * A composited page as the bytes one profile asks for.
 *
 * The engine call is synchronous and lands on this thread, which is what makes
 * a run something the caller has to yield around — see the note where it does.
 */
export function encodePage(page: OffscreenCanvas, profile: ExportProfile): Uint8Array {
  const size = targetSize({ w: page.width, h: page.height }, profile.size)
  const scaled = resizeCanvas(page, size.w, size.h)
  const ctx = scaled.getContext('2d')
  if (!ctx) throw new EncodeError('OffscreenCanvas 2d context unavailable')
  const image = ctx.getImageData(0, 0, size.w, size.h)

  const bytes = window.engine.encodeImage(new Uint8Array(image.data.buffer), size.w, size.h, {
    format: profile.format,
    colorMode: profile.colorMode,
    maxBytes: profile.maxBytes ?? undefined,
  })

  // The encoder hands back its smallest attempt rather than failing, because
  // only here is it known which page this was and what a miss is worth.
  if (profile.maxBytes !== null && bytes.length > profile.maxBytes) {
    throw new EncodeError(
      `壓不到 ${Math.round(profile.maxBytes / 1024)} KB(最小 ${Math.round(bytes.length / 1024)} KB)`,
    )
  }
  return bytes
}
