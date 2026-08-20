import { ref } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { layersDirOf } from '@shared/ssk/constants'
import {
  clamp,
  framePoint,
  positionHolding,
  turnedAround,
  screenDeltaToContentPx,
  type Displacement,
  type ViewTransform,
} from '@/lib/coords'
import {
  NO_PLACEMENT,
  applyPlacement,
  contentBounds,
  frameCenter,
  isMoved,
  placedFrame,
  type LayerPlace,
  type LayerPlacement,
} from '@/lib/layerTransform'

/** The frame's own middle, which is what a raster placement's scale grows about. */
const MIDDLE = { x: 0.5, y: 0.5 }
import { context2d, encodePng } from '@/lib/pageComposite'
import type { Rect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'

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
   * A corner reports how much further from the pinned handle the pointer has
   * come, so a press that starts near that handle can report a ratio in the
   * hundreds within one flick of the wrist. Bounded at both ends:
   *
   * the floor keeps a pixel on each axis, since a frame of zero has no box to
   * grab and could never be reached again; the ceiling is the page itself,
   * because everything past its edge is cropped on export and a buffer larger
   * than the page is the bill the layer frame exists to avoid paying.
   *
   * The frame grows about its own middle, so holding `pin` still is a matter of
   * walking that middle back by as much as the pinned corner would otherwise
   * have travelled — which is what the displacement carries.
   */
  function scaleTo(id: string, ratio: number, pin: { x: number; y: number }): void {
    const entry = project.entryById(id)
    const page = editor.maskTarget
    if (entry === undefined || entry.kind !== 'raster' || entry.w <= 0 || entry.h <= 0) return
    const floor = Math.max(1 / entry.w, 1 / entry.h)
    const ceiling =
      page === null ? Infinity : Math.max(floor, Math.min(page.w / entry.w, page.h / entry.h))
    const scale = clamp(ratio, floor, ceiling)

    const was = { w: entry.w, h: entry.h }
    const rotation = placementOf(id).rotation
    const center = frameCenter(entry)
    const held = framePoint(center, was, MIDDLE, pin, rotation)
    const moved = positionHolding(held, { w: was.w * scale, h: was.h * scale }, MIDDLE, pin, rotation)
    set(id, { scale, dx: moved.x - center.x, dy: moved.y - center.y })
  }

  /**
   * The placement turns about the frame's own middle, so a turn around anything
   * else is that turn plus the displacement it leaves the middle at.
   */
  function rotateTo(id: string, rotation: number, pivot: { x: number; y: number }): void {
    const entry = project.entryById(id)
    if (entry === undefined || entry.kind !== 'raster') return
    const center = frameCenter(entry)
    const around = framePoint(center, { w: entry.w, h: entry.h }, MIDDLE, pivot)
    const moved = turnedAround(around, center, rotation)
    set(id, { rotation, dx: moved.x - center.x, dy: moved.y - center.y })
  }

  /**
   * Dropped only once the entry has caught up. Clearing it the moment the
   * pointer is let go would snap the layer back to where it started for as
   * long as the resample and the write take.
   */
  function release(gesture: { id: string } | null): void {
    if (gesture !== null && held.value?.id === gesture.id) held.value = null
  }

  /**
   * The pixels a trimmed box holds, moved rather than redrawn.
   *
   * A whole-pixel blit onto an empty canvas: no scale, no filter, and drawing
   * over nothing leaves the source exactly as it was — so the one resample the
   * gesture is allowed stays the only one. Read back through `ImageData`
   * instead and every faint edge pixel would pay a rounding of its own, since
   * that path converts out of premultiplied alpha and back.
   */
  function cropTo(canvas: OffscreenCanvas, box: Rect): OffscreenCanvas {
    const cropped = new OffscreenCanvas(box.w, box.h)
    const ctx = context2d(cropped)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(canvas, -box.x, -box.y)
    return cropped
  }

  /**
   * The layer redrawn through its placement, into a frame of its own.
   *
   * The source is read at its stored size and the destination is the box the
   * placement lands in, so this is one resample rather than a chain of them —
   * which is the whole reason a gesture is held rather than written through.
   *
   * The frame that comes back is the one the pixels turned out to need, which
   * is not the one that was asked for: an upright box cannot hold a turned
   * rectangle without gaining transparent corners, and nothing later gives
   * them up. A frame that only ever grows would erode the very thing per-layer
   * frames exist for.
   */
  async function bake(
    entry: RasterLayerEntry,
    place: LayerPlacement,
    frame: Rect,
    pageDir: string,
  ): Promise<{ bytes: Uint8Array; frame: Rect }> {
    const source = await window.api.readImage(layersDirOf(pageDir), entry.file)
    const bitmap = await createImageBitmap(new Blob([source as BlobPart]))
    try {
      const canvas = new OffscreenCanvas(frame.w, frame.h)
      const ctx = context2d(canvas)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      applyPlacement(ctx, entry, place, frame)
      ctx.drawImage(bitmap, 0, 0, entry.w, entry.h)

      const held = contentBounds(ctx.getImageData(0, 0, frame.w, frame.h).data, frame.w, frame.h)
      // Nothing survived, which means nothing went in. Keeping the box that was
      // asked for beats writing a frame of zero, which has no handle to grab
      // and could never be reached again.
      if (held === null) return { bytes: await encodePng(canvas), frame }
      const trimmed = {
        x: frame.x + held.x,
        y: frame.y + held.y,
        w: held.w,
        h: held.h,
      }
      if (held.x === 0 && held.y === 0 && held.w === frame.w && held.h === frame.h) {
        return { bytes: await encodePng(canvas), frame: trimmed }
      }
      return { bytes: await encodePng(cropTo(canvas, held)), frame: trimmed }
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
    const page = editor.currentPageId
    const file = page === null ? undefined : project.pageById(page)
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
      /*
       * Whatever the engine is holding for this layer speaks in coordinates
       * measured from the frame it was handed over at, and this moves that
       * frame. Letting it go here is what makes the next edit hand over the
       * layer as it now stands, rather than paint into a grid that is one
       * gesture behind.
       *
       * Settled first, and not only so nothing is lost: baking reads the layer's
       * file, so an unwritten edit would be resampled out of existence.
       */
      const raster = useRasterStore()
      await raster.flush()
      raster.release(entry.id)
      // A pure translation moves the frame and leaves the pixels alone, which
      // is the one gesture that costs nothing — a copy rather than an average.
      if (place.scale === 1 && place.rotation === 0) {
        editor.cmdPlaceLayer(page, entry.id, from, { ...from, x: frame.x, y: frame.y })
        return
      }
      const baked = await bake(entry, place, frame, file.pageDir)
      const to: LayerPlace = {
        file: `${entry.id}.${generateId().slice(0, 8)}.png`,
        ...baked.frame,
      }
      await window.api.writePage(file.pageDir, { layerParts: { [to.file]: baked.bytes } })
      editor.cmdPlaceLayer(page, entry.id, from, to)
    } finally {
      release(gesture)
    }
  }

  return { held, placementOf, moveBy, scaleTo, rotateTo, commit }
}
