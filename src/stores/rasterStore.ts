import { ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import type { EngineLayerFrame, EngineLayerPatch } from '@shared/engine/types'
import type { RasterLayerEntry } from '@shared/page/types'
import { context2d, encodePng } from '@/lib/pageComposite'
import { useEditorStore } from '@/stores/editorStore'

/** One layer's pixels while the engine holds them, in something writable. */
interface HeldLayer {
  /** Frame-sized, so it draws one pixel per pixel at the entry's own frame. */
  canvas: OffscreenCanvas
  frame: EngineLayerFrame
}

/**
 * The pixels of the layers the engine has taken over.
 *
 * A layer is handed over on its first edit and not before, so opening a page
 * costs nothing: most layers on most pages are never written to. Whether the
 * engine holds one is a fact anybody can ask about rather than something to be
 * inferred from what has happened so far — which is what a lazy scheme that
 * needs to answer "was there an edit before this selection change" turns into,
 * and what one long-lived editor abandoned its lazy scheme over.
 *
 * The canvas here is the renderer's copy, kept in step with the engine's tiles
 * by pasting every patch a write hands back. It exists because an `ImageBitmap`
 * cannot be updated in part, and painting is nothing but updating a part.
 */
export const useRasterStore = defineStore('raster', () => {
  const held = shallowRef(new Map<string, HeldLayer>())

  /**
   * Bumped whenever a held layer's pixels or frame changed. The canvases are
   * not reactive — a page-sized one would be walked byte by byte by the devtools
   * plugin — so this is what the stack watches to know it must redraw.
   */
  const revision = ref(0)

  /**
   * The layer's live pixels and the frame they are measured in, or null when
   * the engine is not holding it.
   *
   * The frame comes from here rather than from the manifest because the two are
   * deliberately out of step for as long as a write is being banked: nothing is
   * written before the pixels it names, so the entry keeps pointing at the old
   * file — and the old frame with it — until the new file is on disk. Drawing at
   * the entry's frame in that window would squash a grown layer into the space
   * it used to take.
   */
  function liveLayer(id: string): Readonly<HeldLayer> | null {
    return held.value.get(id) ?? null
  }

  function holds(id: string): boolean {
    return held.value.has(id)
  }

  /**
   * Hands a layer's whole pixels to the engine, once.
   *
   * The decode is the same one the stack does to draw the layer, done again
   * rather than borrowed from it: the stack owns its bitmaps and closes them
   * when a run unmounts, and a takeover that depended on one being alive would
   * be a takeover that fails depending on what is on screen.
   */
  async function take(entry: RasterLayerEntry, layersDir: string): Promise<void> {
    if (held.value.has(entry.id)) return
    const frame: EngineLayerFrame = { x: entry.x, y: entry.y, w: entry.w, h: entry.h }
    const canvas = new OffscreenCanvas(Math.max(1, frame.w), Math.max(1, frame.h))
    let rgba = new Uint8Array(0)
    if (frame.w > 0 && frame.h > 0) {
      const ctx = context2d(canvas)
      const bytes = await window.api.readImage(layersDir, entry.file)
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
      try {
        ctx.drawImage(bitmap, 0, 0)
      } finally {
        bitmap.close()
      }
      rgba = new Uint8Array(ctx.getImageData(0, 0, frame.w, frame.h).data.buffer)
    }
    window.engine.rasterTake(entry.id, rgba, frame)
    held.value.set(entry.id, { canvas, frame })
    revision.value++
  }

  /**
   * Puts what a write handed back onto the layer's own canvas.
   *
   * One path, whether or not the frame moved: the engine hands back the whole
   * frame when it did, so a rebuilt canvas is always fully covered by the very
   * patch that told it to rebuild.
   *
   * `putImageData` rather than a draw, because it ignores compositing entirely —
   * the straight alpha the engine works in survives instead of being blended
   * against what is already on the canvas.
   */
  function paste(id: string, patch: EngineLayerPatch): void {
    const layer = held.value.get(id)
    if (layer === undefined) return
    const { frame, changed } = patch
    if (
      frame.x !== layer.frame.x ||
      frame.y !== layer.frame.y ||
      frame.w !== layer.frame.w ||
      frame.h !== layer.frame.h
    ) {
      layer.canvas = new OffscreenCanvas(Math.max(1, frame.w), Math.max(1, frame.h))
      layer.frame = { ...frame }
    }
    if (changed.w > 0 && changed.h > 0) {
      const image = new ImageData(changed.w, changed.h)
      image.data.set(patch.rgba)
      context2d(layer.canvas).putImageData(image, changed.x - frame.x, changed.y - frame.y)
    }
    revision.value++
  }

  /** The held layer as file bytes, for the write that follows an edit. */
  async function encode(id: string): Promise<Uint8Array | null> {
    const layer = held.value.get(id)
    if (layer === undefined || layer.frame.w <= 0 || layer.frame.h <= 0) return null
    return encodePng(layer.canvas)
  }

  function release(id: string): void {
    if (!held.value.delete(id)) return
    window.engine.rasterRelease(id)
    revision.value++
  }

  function releaseAll(): void {
    if (held.value.size === 0) return
    held.value.clear()
    window.engine.rasterReleaseAll()
    revision.value++
  }

  /**
   * Turning the page lets everything go. The pixels are on disk and the records
   * that spoke for them are gone with them, so nothing is being thrown away that
   * anybody could still ask for.
   */
  watch(() => useEditorStore().currentPageId, releaseAll)

  return { revision, liveLayer, holds, take, paste, encode, release, releaseAll }
})
