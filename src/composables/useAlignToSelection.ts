import { computed, type ComputedRef } from 'vue'
import type { RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import { useCanvasLabel } from '@/composables/useCanvasLabel'
import { inkOfLabel, shiftOnto, type AlignAxes } from '@/lib/alignToSelection'
import { alphaBounds } from '@/lib/layerEffects'
import type { Rect } from '@/lib/selection/rect'
import { isEmptyRect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'
import { useSelectionStore } from '@/stores/selectionStore'

export interface AlignToSelection {
  /** Whether there is something to align to and something selected on this page that can move. */
  ready: ComputedRef<boolean>
  align(axes: AlignAxes): void
}

/**
 * Photoshop's align: every selected object, each on its own, centred across,
 * down or both on one box. With a selection up on this page that box is the
 * selection's — the box of whatever is selected, so a wand click on a balloon
 * is a balloon's box. Without one, two or more selected objects are each
 * other's reference, and the box is the one around all of their ink.
 *
 * What is centred is what the object shows: a text object's ink as the canvas
 * draws it, a raster layer's pixels. Folders are left alone, as the arrow keys
 * leave them.
 */
export function useAlignToSelection(): AlignToSelection {
  const editor = useEditorStore()
  const project = useProjectStore()
  const selection = useSelectionStore()
  const raster = useRasterStore()
  const labels = useCanvasLabel()

  const target = computed<Rect | null>(() => {
    const page = editor.currentPageId
    const bounds = selection.bounds
    if (page === null || bounds === null || isEmptyRect(bounds) || selection.heldPage() !== page) return null
    return bounds
  })

  const movable = computed(() => {
    const page = editor.currentPageId
    if (page === null) return []
    return [...editor.selectedIds]
      .map((id) => project.entryById(id))
      .filter((entry) => entry !== undefined && (entry.kind === 'text' || entry.kind === 'raster'))
      .filter((entry) => !editor.isLayerLocked(entry!.id) && project.pageOfEntry(entry!.id) === page)
      .map((entry) => entry!)
  })

  function rasterInk(entry: RasterLayerEntry): Rect | null {
    // The held frame, which an unsaved paint may have grown past the manifest's.
    const { x, y, w, h } = raster.frameOf(entry)
    const frame = { x, y, w, h }
    if (isEmptyRect(frame)) return null
    if (!window.engine.rasterHolds(entry.id)) return frame
    const rgba = window.engine.rasterRead(entry.id, frame)
    const box = alphaBounds(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), frame.w, frame.h)
    return box && { x: frame.x + box.x, y: frame.y + box.y, w: box.w, h: box.h }
  }

  function inkOf(entry: TextLayerEntry | RasterLayerEntry): Rect | null {
    return entry.kind === 'text' ? inkOfLabel(labels.labelOf(entry)) : rasterInk(entry)
  }

  function align(axes: AlignAxes): void {
    const page = editor.currentPageId
    if (page === null) return
    const inks = movable.value.flatMap((entry) => {
      const ink = inkOf(entry)
      return ink === null ? [] : [{ id: entry.id, ink }]
    })
    const to = target.value ?? (inks.length >= 2 ? around(inks.map((i) => i.ink)) : null)
    if (to === null) return
    const moves = inks.map(({ id, ink }) => ({ id, ...shiftOnto(ink, to, axes) }))
    editor.cmdShiftObjects(page, moves, `align-${axes}`)
  }

  return {
    ready: computed(() => (target.value !== null && movable.value.length > 0) || movable.value.length >= 2),
    align,
  }
}

function around(boxes: readonly Rect[]): Rect {
  const x0 = Math.min(...boxes.map((b) => b.x))
  const y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.w))
  const y1 = Math.max(...boxes.map((b) => b.y + b.h))
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
