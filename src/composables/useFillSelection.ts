import { computed } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { allEntries } from '@shared/page/tree'
import { nextAutoName } from '@/lib/autoName'
import { hexToRgb } from '@/lib/color'
import { fillPixels } from '@/lib/selection/fill'
import { context2d, encodePng } from '@/lib/pageComposite'
import { isEmptyRect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore, type RemovedEntry } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'

async function encodePatch(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(w, h)
  const ctx = context2d(canvas)
  const image = new ImageData(w, h)
  image.data.set(pixels)
  // Written rather than drawn: putImageData ignores compositing entirely, so
  // the straight alpha the mask became survives into the PNG unmultiplied.
  ctx.putImageData(image, 0, 0)
  return encodePng(canvas)
}

/**
 * Filling a selection with the foreground colour, onto a raster layer of its own.
 *
 * This is the first thing that consumes a selection, and the first thing that
 * puts pixels on a page — which is what makes the layer tree's opacity, blend
 * mode and thumbnail mean anything at all. The layer's frame is the selection's
 * bounding box and its alpha is the mask, so the patch and the shape that made
 * it are one object rather than two that have to be kept in step.
 *
 * Sampling the balloon's own background instead of taking the foreground colour
 * is what the erase workflow will want; it is a second colour source for this
 * same command rather than a different command.
 */
export function useFillSelection() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const selection = useSelectionStore()

  const canFill = computed(
    () =>
      editor.currentFilename !== null &&
      selection.bounds !== null &&
      !isEmptyRect(selection.bounds),
  )

  function nextFillName(page: string): string {
    const taken = new Set(
      allEntries(project.fileByName(page)?.page.layers ?? [])
        .filter((e) => e.kind === 'raster')
        .map((e) => e.name),
    )
    return nextAutoName(taken, '填充')
  }

  async function fillSelection(): Promise<void> {
    const page = editor.currentFilename
    const bounds = selection.bounds
    if (page === null || bounds === null || isEmptyRect(bounds)) return
    const file = project.fileByName(page)
    if (!file) return
    const color = hexToRgb(editor.foreground)
    if (color === null) return
    const alpha = selection.maskPatchOf(page, bounds)
    if (alpha === null) return

    const id = generateId()
    /*
     * A name nothing else has ever held, on every write. The manifest is
     * written after the pixels it names, so a crash between the two leaves the
     * previous manifest pointing at data that is all still there — which
     * reusing a file name is exactly what would destroy. Whatever no manifest
     * names any more is swept when the project is next opened.
     */
    const layerFile = `${id}.${generateId().slice(0, 8)}.png`
    const bytes = await encodePatch(fillPixels(alpha, color), bounds.w, bounds.h)
    await window.api.writePage(file.pageDir, { layerParts: { [layerFile]: bytes } })

    const entry: RasterLayerEntry = {
      kind: 'raster',
      id,
      name: nextFillName(page),
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      file: layerFile,
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
      alphaLocked: false,
    }

    let removed: RemovedEntry | null = null
    editor.pushCommand({
      label: `fill-selection ${id}`,
      do: () => {
        if (removed === null) project.addLayer(page, entry)
        else project.restoreEntry(removed)
      },
      undo: () => {
        removed = project.removeEntry(id)
      },
    })
    editor.selectOnly(id)
  }

  return { canFill, fillSelection }
}
