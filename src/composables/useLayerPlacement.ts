import { ref } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { layersDirOf } from '@shared/ssk/constants'
import { clamp, screenDeltaToContentPx, type Displacement, type ViewTransform } from '@/lib/coords'
import {
  NO_PLACEMENT,
  applyPlacement,
  isMoved,
  placedFrame,
  type LayerPlace,
  type LayerPlacement,
} from '@/lib/layerTransform'
import { context2d, encodePng } from '@/lib/pageComposite'
import type { Rect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * Moving, turning and scaling a raster layer, and writing the result down.
 *
 * A raster layer carries no transform. Every editor's ordinary paint layer
 * works this way and no file format has the field — the reason is that a layer
 * holding an unapplied transform can no longer be painted on, because a brush
 * stroke would have no honest coordinate system to be recorded in. So a gesture
 * previews as a placement and is resampled into the pixels when it is let go.
 *
 * The cost is generation loss: resampling is a weighted average of neighbours,
 * and what it discards no later pass restores. That is why the placement is
 * held whole here and applied once, rather than the entry being rewritten as
 * the pointer moves.
 */
export function useLayerPlacement() {
  const project = useProjectStore()
  const editor = useEditorStore()

  /** The gesture in progress. Nobody's data until it is let go. */
  const held = ref<{ id: string; place: LayerPlacement } | null>(null)

  function placementOf(id: string): LayerPlacement {
    return held.value?.id === id ? held.value.place : NO_PLACEMENT
  }

  function set(id: string, part: Partial<LayerPlacement>): void {
    if (editor.isLayerLocked(id)) return
    held.value = { id, place: { ...placementOf(id), ...part } }
  }

  function moveBy(id: string, d: Displacement, view: ViewTransform): void {
    const delta = screenDeltaToContentPx(d.dx, d.dy, view)
    set(id, { dx: delta.x, dy: delta.y })
  }

  /**
   * A corner reports how much further from the centre the pointer has come, so
   * a press that starts near the centre can report a ratio in the hundreds
   * within one flick of the wrist. Bounded at both ends:
   *
   * the floor keeps a pixel on each axis, since a frame of zero has no box to
   * grab and could never be reached again; the ceiling is the page itself,
   * because everything past its edge is cropped on export and a buffer larger
   * than the page is the bill the layer frame exists to avoid paying.
   */
  function scaleTo(id: string, ratio: number): void {
    const entry = project.entryById(id)
    const page = editor.maskTarget
    if (entry === undefined || entry.kind !== 'raster' || entry.w <= 0 || entry.h <= 0) return
    const floor = Math.max(1 / entry.w, 1 / entry.h)
    const ceiling =
      page === null ? Infinity : Math.max(floor, Math.min(page.w / entry.w, page.h / entry.h))
    set(id, { scale: clamp(ratio, floor, ceiling) })
  }

  const rotateTo = (id: string, rotation: number) => set(id, { rotation })

  /**
   * Dropped only once the entry has caught up. Clearing it the moment the
   * pointer is let go would snap the layer back to where it started for as
   * long as the resample and the write take.
   */
  function release(gesture: { id: string } | null): void {
    if (gesture !== null && held.value?.id === gesture.id) held.value = null
  }

  /**
   * The layer redrawn through its placement, into a frame of its own.
   *
   * The source is read at its stored size and the destination is the box the
   * placement lands in, so this is one resample rather than a chain of them —
   * which is the whole reason a gesture is held rather than written through.
   */
  async function bake(
    entry: RasterLayerEntry,
    place: LayerPlacement,
    frame: Rect,
    pageDir: string,
  ): Promise<Uint8Array> {
    const bytes = await window.api.readImage(layersDirOf(pageDir), entry.file)
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    try {
      const canvas = new OffscreenCanvas(frame.w, frame.h)
      const ctx = context2d(canvas)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      applyPlacement(ctx, entry, place, frame)
      ctx.drawImage(bitmap, 0, 0, entry.w, entry.h)
      return await encodePng(canvas)
    } finally {
      bitmap.close()
    }
  }

  /**
   * Nothing is written before the pixels it names. The manifest is saved after
   * the layer file, so a crash between the two leaves the old manifest pointing
   * at the old file, which is still there — and a name nothing has ever held is
   * what keeps that true. Whatever no manifest names is swept at the next open.
   */
  async function commit(entry: RasterLayerEntry): Promise<void> {
    const gesture = held.value
    const page = editor.currentFilename
    const file = page === null ? undefined : project.fileByName(page)
    if (
      gesture === null ||
      gesture.id !== entry.id ||
      page === null ||
      file === undefined ||
      !isMoved(gesture.place) ||
      editor.isLayerLocked(entry.id) ||
      entry.w <= 0 ||
      entry.h <= 0
    ) {
      release(gesture)
      return
    }

    try {
      const place = gesture.place
      const frame = placedFrame(entry, place)
      const from: LayerPlace = { file: entry.file, x: entry.x, y: entry.y, w: entry.w, h: entry.h }
      // A pure translation moves the frame and leaves the pixels alone, which
      // is the one gesture that costs nothing — a copy rather than an average.
      if (place.scale === 1 && place.rotation === 0) {
        editor.cmdPlaceLayer(page, entry.id, from, { ...from, x: frame.x, y: frame.y })
        return
      }
      const to: LayerPlace = { file: `${entry.id}.${generateId().slice(0, 8)}.png`, ...frame }
      const bytes = await bake(entry, place, frame, file.pageDir)
      await window.api.writePage(file.pageDir, { layerParts: { [to.file]: bytes } })
      editor.cmdPlaceLayer(page, entry.id, from, to)
    } finally {
      release(gesture)
    }
  }

  return { held, placementOf, moveBy, scaleTo, rotateTo, commit }
}
