import { ref, shallowRef, watch } from 'vue'
import { defineStore } from 'pinia'
import type { EngineLayerFrame, EngineLayerPixels } from '@shared/engine/types'
import { generateId } from '@shared/page/schema'
import type { RasterLayerEntry } from '@shared/page/types'
import { createAutosave, PIXEL_DEBOUNCE_MS, PIXEL_MAX_WAIT_MS } from '@/lib/autosave'
import { context2d, encodePng } from '@/lib/pageComposite'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/** One layer's pixels while the engine holds them, in something writable. */
interface HeldLayer {
  /** Frame-sized, so it draws one pixel per pixel at the entry's own frame. */
  canvas: OffscreenCanvas
  frame: EngineLayerFrame
  /** The page it belongs to, and where its files live. */
  pageId: string
  pageDir: string
  /** Whether what is on disk is behind what is here. */
  owes: boolean
  /** Whether a write for this layer has landed yet in this session. */
  written: boolean
}

/**
 * The pixels of the layers the engine has taken over, and their way to disk.
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
   * The pixel half of saving, on a clock of its own and a much slower one than
   * the manifest's. Encoding a whole layer is a tenth of a second or two: paid
   * per stroke that is two orders of magnitude too much, paid every few tens of
   * seconds in the background it is nothing.
   */
  const pixels = createAutosave(() => settle(), {
    debounceMs: PIXEL_DEBOUNCE_MS,
    maxWaitMs: PIXEL_MAX_WAIT_MS,
    onError: (err) => console.error('layer autosave failed', err),
  })

  /**
   * The layer's live pixels and the frame they are measured in, or null when
   * the engine is not holding it.
   *
   * The frame comes from here rather than from the manifest because the two are
   * deliberately out of step for as long as a write is owed: nothing is written
   * before the pixels it names, so the entry keeps pointing at the old file —
   * and the old frame with it — until the new file is on disk. Drawing at the
   * entry's frame in that window would squash a grown layer into the space it
   * used to take.
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
  async function take(
    entry: RasterLayerEntry,
    pageId: string,
    layersDir: string,
    pageDir: string,
  ): Promise<void> {
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
    held.value.set(entry.id, {
      canvas,
      frame,
      pageId,
      pageDir,
      owes: false,
      written: false,
    })
    revision.value++
  }

  /**
   * Puts pixels the engine handed back onto the layer's own canvas.
   *
   * One path, whether or not the frame moved: a rebuilt canvas is always fully
   * covered by the very patch that told it to rebuild. A write hands back the
   * whole frame when the frame moved; a stroke's preview, which is the other
   * caller, follows the same rule for the same reason.
   *
   * `putImageData` rather than a draw, because it ignores compositing entirely —
   * the straight alpha the engine works in survives instead of being blended
   * against what is already on the canvas.
   */
  function paste(id: string, patch: EngineLayerPixels): void {
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

  /**
   * Says a layer's pixels have moved past what is on disk.
   *
   * The first write of a layer goes down at once and the rest are scheduled.
   * That first one is where the layer's file name and frame stop being what the
   * page was opened with, and having that on disk before anything else happens
   * is worth one encode.
   */
  async function owe(id: string): Promise<void> {
    const layer = held.value.get(id)
    if (layer === undefined) return
    layer.owes = true
    // What the title bar's unsaved marker reads. The manifest itself is
    // untouched until the pixels land, but the page is not on disk as it stands.
    useProjectStore().markPageDirty(layer.pageId)
    pixels.mark()
    if (!layer.written) await pixels.flush()
  }

  /**
   * Writes every layer that owes, names the new files in the manifest, and only
   * then drops the versions they replaced.
   *
   * The order is the safety property: at no moment does a manifest on disk name
   * a file that is gone. And the version a flush leaves behind has no reader —
   * undo works against the tiles the engine holds, never against an old file —
   * so dropping it here is a deletion of something nothing could ask for. A
   * feature like "back to the last save" would break that and this with it.
   */
  async function settle(): Promise<void> {
    const project = useProjectStore()
    const owing = [...held.value].filter(([, layer]) => layer.owes)
    if (owing.length === 0) return

    const superseded: { pageDir: string; file: string }[] = []
    for (const [id, layer] of owing) {
      layer.owes = false
      const entry = project.entryById(id)
      if (entry?.kind !== 'raster' || layer.frame.w <= 0 || layer.frame.h <= 0) continue
      /*
       * A name nothing else has ever held, on every write. The manifest is
       * written after the pixels it names, so a crash between the two leaves the
       * previous manifest pointing at data that is all still there — which
       * reusing a file name is exactly what would destroy.
       */
      const file = `${id}.${generateId().slice(0, 8)}.png`
      const previous = entry.file
      await window.api.writePage(layer.pageDir, {
        layerParts: { [file]: await encodePng(layer.canvas) },
      })
      // File and frame together, always: the file's own dimensions are the
      // frame, and a manifest holding one of them from each version draws the
      // layer stretched.
      project.placeLayer(layer.pageId, id, { file, ...layer.frame })
      layer.written = true
      if (previous !== file) superseded.push({ pageDir: layer.pageDir, file: previous })
    }

    await project.flushManifest()
    for (const gone of superseded) {
      await window.api.deleteLayerParts(gone.pageDir, [gone.file])
    }
  }

  /** The held layer as file bytes, for anything that wants them without a write. */
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
   * Turning the page starts the write and does not wait for it. Paging is a move
   * of the eyes, and stalling one on an encode would make the page turn feel
   * like the disk.
   *
   * The layers of the page being left go once their bytes are down — which is
   * also the only safe moment, since letting a canvas go is letting the only
   * copy of what it holds go. One that took a fresh edit while the write was out
   * stays, and leaves on the next turn.
   */
  watch(
    () => useEditorStore().currentPageId,
    (_now, before) => {
      if (before === undefined || before === null) return
      const leaving = [...held.value]
        .filter(([, layer]) => layer.pageId === before)
        .map(([id]) => id)
      if (leaving.length === 0) return
      void pixels.flush().finally(() => {
        for (const id of leaving) {
          if (held.value.get(id)?.owes === false) release(id)
        }
      })
    },
  )

  // Whoever reads `layers/` waits for this. Registered rather than called from
  // each of them, so a consumer added later inherits the obligation.
  useProjectStore().oweBeforeLayerRead(() => pixels.flush())

  return {
    revision,
    liveLayer,
    holds,
    take,
    paste,
    owe,
    encode,
    flush: pixels.flush,
    release,
    releaseAll,
  }
})
