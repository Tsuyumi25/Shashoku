import { computed, type ComputedRef } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
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
  /** Whether there is a selection on this page and something selected on it that can move. */
  ready: ComputedRef<boolean>
  align(axes: AlignAxes): void
}

/**
 * Photoshop's align with a selection up: every selected object, each on its
 * own, centred on the selection's box across, down or both — the box of
 * whatever is selected, so a wand click on a balloon is a balloon's box.
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

  function align(axes: AlignAxes): void {
    const page = editor.currentPageId
    const to = target.value
    if (page === null || to === null) return
    const moves = movable.value.flatMap((entry) => {
      const ink = entry.kind === 'text' ? inkOfLabel(labels.labelOf(entry)) : rasterInk(entry as RasterLayerEntry)
      return ink === null ? [] : [{ id: entry.id, ...shiftOnto(ink, to, axes) }]
    })
    editor.cmdShiftObjects(page, moves, `align-${axes}`)
  }

  return {
    ready: computed(() => target.value !== null && movable.value.length > 0),
    align,
  }
}
