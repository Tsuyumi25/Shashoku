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

/** A rectangle on the page, which is what a raster layer occupies. */
interface Frame {
  x: number
  y: number
  w: number
  h: number
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
 * plane cannot outlive the pixels it was read from — and on the live state
 * instead for a layer being edited, whose file name stands still while its
 * pixels move.
 */
export function useLayerAlpha(
  layersDir: () => string | null,
  /** Whatever a press could reach right now, so nothing unreachable is decoded. */
  wanted: () => readonly RasterLayerEntry[],
  /**
   * A layer's live pixels and a name for the state they are in, for layers
   * being edited.
   *
   * Pixels reach disk on a scheduler of their own, so a layer just painted on
   * keeps its old file name for tens of seconds — and a plane keyed on that
   * name would let the pointer fall straight through paint that is plainly on
   * screen. The key changes when the pixels do, which is what keeps the cache
   * honest without this having to know what changed.
   */
  live: (entry: RasterLayerEntry) => { canvas: OffscreenCanvas; frame: Frame; key: string } | null,
  /**
   * Where a layer's pixels are. Injected rather than derived from `live`,
   * because the canvas bounds a hit against the same frame this reads it at and
   * the two agreeing must not be a coincidence of two derivations.
   *
   * Neither has a default. One that fell back to the entry would answer for a
   * layer being edited with the frame from before the edit — which is the bug
   * this argument exists to close, reintroduced silently for whoever writes the
   * second caller.
   */
  frameOf: (entry: RasterLayerEntry) => Frame,
) {
  const planes = new Map<string, AlphaPlane>()
  let token = 0

  /** The alpha channel of something already drawn, at its own size. */
  function planeOf(canvas: OffscreenCanvas): AlphaPlane | null {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const alpha = new Uint8Array(canvas.width * canvas.height)
    for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3]
    return { w: canvas.width, h: canvas.height, alpha }
  }

  async function read(dir: string, file: string): Promise<AlphaPlane | null> {
    const bytes = await window.api.readImage(dir, file)
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0)
      return planeOf(canvas)
    } finally {
      bitmap.close()
    }
  }

  /** What a layer's plane is filed under: its live state, or its file name. */
  function keyOf(entry: RasterLayerEntry): string {
    return live(entry)?.key ?? entry.file
  }

  async function load(): Promise<void> {
    const mine = ++token
    const dir = layersDir()
    const entries = wanted()
    const keys = new Set(entries.map(keyOf))
    for (const key of planes.keys()) if (!keys.has(key)) planes.delete(key)
    for (const entry of entries) {
      const key = keyOf(entry)
      if (planes.has(key)) continue
      const held = live(entry)
      if (held !== null) {
        const plane = planeOf(held.canvas)
        if (plane) planes.set(key, plane)
        continue
      }
      if (dir === null) continue
      try {
        const plane = await read(dir, entry.file)
        // A page turned while this was out belongs to nobody now, and the layer
        // may not even be on the page any more.
        if (mine !== token) return
        if (plane) planes.set(key, plane)
      } catch (err) {
        // The stack draws what it can and says so there; a patch this cannot
        // read is one the pointer passes through, which is the same answer as
        // a patch that is not there.
        console.error('layer alpha unavailable', entry.file, err)
      }
    }
  }

  watch(
    () => [layersDir(), wanted().map(keyOf).join(' ')] as const,
    () => {
      void load()
    },
    { immediate: true },
  )

  /**
   * One point of the page, as this layer's coverage there — zero for anything
   * not read yet, and zero outside, which is what a layer with nothing there
   * means.
   *
   * Taken in page pixels and put into the frame the plane was actually read at,
   * which for a layer being edited is ahead of the entry's. The frame is also
   * what the bitmap is drawn into, so a bitmap that is not the frame's size is
   * being stretched onto the page and the point is stretched with it.
   */
  function alphaAt(entry: RasterLayerEntry, at: { x: number; y: number }): number {
    const plane = planes.get(keyOf(entry))
    if (plane === undefined) return 0
    const frame = frameOf(entry)
    if (frame.w <= 0 || frame.h <= 0) return 0
    const lx = at.x - frame.x
    const ly = at.y - frame.y
    const px = Math.min(plane.w - 1, Math.floor((lx * plane.w) / frame.w))
    const py = Math.min(plane.h - 1, Math.floor((ly * plane.h) / frame.h))
    if (px < 0 || py < 0) return 0
    return plane.alpha[py * plane.w + px]
  }

  return { alphaAt }
}
