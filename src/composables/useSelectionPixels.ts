import { computed } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { allEntries } from '@shared/page/tree'
import { layersDirOf } from '@shared/ssk/constants'
import { useRasterTarget } from '@/composables/useRasterTarget'
import { nextAutoName } from '@/lib/autoName'
import { context2d, encodePng } from '@/lib/pageComposite'
import { maskPixels } from '@/lib/selection/fill'
import { isEmptyRect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore, type RemovedEntry } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'
import { useSelectionStore } from '@/stores/selectionStore'

/**
 * The selection's two other exits: taking what is inside it out of the layer,
 * and lifting what is inside it onto a layer of its own.
 *
 * They ask different things of storage and that is the whole reason they are
 * written together rather than each beside the operation it resembles. Erasing
 * changes a committed layer, so it goes through the engine's scratch and one
 * transaction like every other write. Lifting only reads its source, so it is
 * the same shape the fill used to have — encode a patch, add an entry, and
 * leave the layer it came from untouched to the pixel.
 */
export function useSelectionPixels() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const selection = useSelectionStore()
  const preferences = usePreferencesStore()
  const raster = useRasterStore()
  const { target, refuse } = useRasterTarget()

  const hasArea = computed(() => selection.bounds !== null && !isEmptyRect(selection.bounds))

  /**
   * Whether Delete means "take these pixels out" rather than "take this layer
   * out".
   *
   * The one key that has to answer both, and the situation decides which — as
   * it does in Photoshop, where Delete over a selection erases and the layer
   * goes from the panel. Deliberately true for a layer that will refuse the
   * write as well: what the key means is not settled by whether it succeeds, and
   * a Delete that quietly took the whole layer instead would be the worst
   * possible answer to a lock.
   */
  const erasesPixels = computed(() => hasArea.value && target.value !== null)

  /** Ctrl+J lifts the selection when there is one, and copies the layer when not. */
  const liftsSelection = computed(() => erasesPixels.value)

  /**
   * Takes the selection's pixels out of the layer under the cursor.
   *
   * The same path a fill takes, with the eraser's operator: a scratch layer, one
   * transaction, one swappable record. A tile emptied outright goes back to
   * being no tile at all, which is the only spelling of transparent there is.
   */
  async function eraseSelection(): Promise<void> {
    const page = editor.currentPageId
    const bounds = selection.bounds
    const entry = target.value
    if (page === null || bounds === null || isEmptyRect(bounds) || entry === null) return
    const file = project.pageById(page)
    if (!file || refuse(page, entry)) return
    const mask = selection.maskPatchOf(page, bounds)
    if (mask === null) return

    await raster.take(entry, page, layersDirOf(file.pageDir), file.pageDir)
    editor.forgetJournals(
      window.engine.rasterTrimHistory(
        preferences.prefs.undoPixelSteps,
        preferences.prefs.undoPixelBytes,
      ),
    )

    const patch = window.engine.rasterErase(entry.id, new Uint8Array(mask), {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w,
      h: bounds.h,
    })
    if (patch === null) return
    raster.paste(entry.id, patch)
    await raster.owe(entry.id)

    const swap = () => {
      const back = window.engine.rasterApplyJournal(patch.journal)
      if (back !== null) raster.paste(entry.id, back)
      void raster.owe(entry.id)
    }
    editor.pushCommand(
      {
        label: `erase-selection ${entry.id}`,
        journal: patch.journal,
        do: swap,
        undo: swap,
        forget: () => window.engine.rasterDropJournal(patch.journal),
      },
      { alreadyApplied: true },
    )
  }

  function nextLiftName(page: string): string {
    const taken = new Set(
      allEntries(project.pageById(page)?.page.layers ?? [])
        .filter((e) => e.kind === 'raster')
        .map((e) => e.name),
    )
    return nextAutoName(taken, '拷貝')
  }

  /**
   * Copies the selection's part of the layer under the cursor onto a new layer
   * above it, leaving the source untouched.
   *
   * Reads the file rather than the engine's tiles, which is why the pixels are
   * settled first: this is a consumer of `layers/` like the export is, and the
   * newest paint may only be in memory.
   */
  async function liftSelection(): Promise<void> {
    const page = editor.currentPageId
    const bounds = selection.bounds
    const entry = target.value
    if (page === null || bounds === null || isEmptyRect(bounds) || entry === null) return
    const file = project.pageById(page)
    if (!file || refuse(page, entry)) return
    if (entry.w <= 0 || entry.h <= 0) return
    const mask = selection.maskPatchOf(page, bounds)
    if (mask === null) return

    await project.flush()
    const source = project.entryById(entry.id)
    if (source?.kind !== 'raster') return

    const bytes = await encodePng(
      await liftedPatch(source, layersDirOf(file.pageDir), bounds, mask),
    )
    const id = generateId()
    /*
     * A name nothing else has ever held, on every write. The manifest is
     * written after the pixels it names, so a crash between the two leaves the
     * previous manifest pointing at data that is all still there.
     */
    const layerFile = `${id}.${generateId().slice(0, 8)}.png`
    await window.api.writePage(file.pageDir, { layerParts: { [layerFile]: bytes } })

    const lifted: RasterLayerEntry = {
      kind: 'raster',
      id,
      name: nextLiftName(page),
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
      label: `lift-selection ${id}`,
      do: () => {
        if (removed === null) project.addLayer(page, lifted)
        else project.restoreEntry(removed)
      },
      undo: () => {
        removed = project.removeEntry(id)
      },
    })
    editor.selectOnly(id)
  }

  /** The source's pixels inside the selection, wearing the selection's shape. */
  async function liftedPatch(
    source: RasterLayerEntry,
    layersDir: string,
    bounds: { x: number; y: number; w: number; h: number },
    mask: Uint8ClampedArray,
  ): Promise<OffscreenCanvas> {
    const canvas = new OffscreenCanvas(bounds.w, bounds.h)
    const ctx = context2d(canvas)
    const bytes = await window.api.readImage(layersDir, source.file)
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    try {
      // Drawn at the source's own frame so the copy lines up pixel for pixel,
      // then read back and cut to shape. The frame is where the file's pixels
      // sit on the page, so this is a translation and never a resample.
      ctx.drawImage(bitmap, source.x - bounds.x, source.y - bounds.y, source.w, source.h)
    } finally {
      bitmap.close()
    }
    const image = ctx.getImageData(0, 0, bounds.w, bounds.h)
    maskPixels(image.data, mask)
    // Written rather than drawn: putImageData ignores compositing entirely, so
    // the straight alpha the mask left survives into the PNG unmultiplied.
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  return { erasesPixels, liftsSelection, eraseSelection, liftSelection }
}
