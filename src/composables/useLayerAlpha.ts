import { watch } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'

/**
 * One layer's coverage, read back once and kept: the alpha channel alone, at
 * the size the PNG decoded to.
 *
 * A quarter of the decoded bitmap, which is what makes holding every reachable
 * layer at once affordable — and an index into it costs nothing, which is what
 * a hit test on every pointer move needs.
 */
interface AlphaPlane {
  w: number
  h: number
  alpha: Uint8Array
}

/**
 * The pixels the canvas hit-tests against.
 *
 * Kept here rather than asked for on the press, because the press has to be
 * answered on the spot and decoding is not: a click that had to wait for a file
 * would land after the pointer had gone. So whatever the page currently offers
 * to be clicked is read ahead, and a layer whose read has not landed yet is
 * simply not hit — the pointer passes through it for as long as that takes.
 *
 * Keyed on the file name, which every write to a layer mints anew, so a stale
 * plane cannot outlive the pixels it was read from.
 */
export function useLayerAlpha(
  layersDir: () => string | null,
  /** Whatever a press could reach right now, so nothing unreachable is decoded. */
  wanted: () => readonly RasterLayerEntry[],
) {
  const planes = new Map<string, AlphaPlane>()
  let token = 0

  async function read(dir: string, file: string): Promise<AlphaPlane | null> {
    const bytes = await window.api.readImage(dir, file)
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      const alpha = new Uint8Array(canvas.width * canvas.height)
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3]
      return { w: canvas.width, h: canvas.height, alpha }
    } finally {
      bitmap.close()
    }
  }

  async function load(): Promise<void> {
    const mine = ++token
    const dir = layersDir()
    const files = new Set(wanted().map((entry) => entry.file))
    for (const file of planes.keys()) if (!files.has(file)) planes.delete(file)
    if (dir === null) return
    for (const file of files) {
      if (planes.has(file)) continue
      try {
        const plane = await read(dir, file)
        // A page turned while this was out belongs to nobody now, and the layer
        // may not even be on the page any more.
        if (mine !== token) return
        if (plane) planes.set(file, plane)
      } catch (err) {
        // The stack draws what it can and says so there; a patch this cannot
        // read is one the pointer passes through, which is the same answer as
        // a patch that is not there.
        console.error('layer alpha unavailable', file, err)
      }
    }
  }

  watch(
    () => [layersDir(), wanted().map((entry) => entry.file).join(' ')] as const,
    () => {
      void load()
    },
    { immediate: true },
  )

  /**
   * One point of a layer, in its own whole pixels — zero for anything not read
   * yet, and zero outside, which is what a layer with nothing there means.
   *
   * The frame is what the bitmap is drawn into, so a bitmap that is not the
   * frame's size is being stretched onto the page and the point has to be
   * stretched with it.
   */
  function alphaAt(entry: RasterLayerEntry, x: number, y: number): number {
    const plane = planes.get(entry.file)
    if (plane === undefined || entry.w <= 0 || entry.h <= 0) return 0
    const px = Math.min(plane.w - 1, Math.floor((x * plane.w) / entry.w))
    const py = Math.min(plane.h - 1, Math.floor((y * plane.h) / entry.h))
    if (px < 0 || py < 0) return 0
    return plane.alpha[py * plane.w + px]
  }

  return { alphaAt }
}
