import { computed } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { isHidden, isLocked } from '@shared/page/tree'
import { layersDirOf } from '@shared/ssk/constants'
import { isEmptyRect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'
import { useSelectionStore } from '@/stores/selectionStore'

/** Everything about where a layer's pixels are, which a fill can move. */
interface LayerPlace {
  file: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * Filling a selection with the foreground colour, onto the layer already
 * selected.
 *
 * It used to make a layer of its own, which meant a page retouched ten times
 * grew ten layers and the plainest gesture in the medium — put paint on the
 * thing I am pointing at — had no way to be asked for. The selection is the
 * shape and the layer is the target; nothing joins the tree.
 *
 * The write never touches the committed layer directly. A scratch layer takes
 * the paint, the mask is applied as it lands, and one transaction composites the
 * result — which is what makes the record a single swap and what the brush will
 * reuse unchanged.
 */
export function useFillSelection() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const selection = useSelectionStore()
  const notices = useNoticeStore()
  const preferences = usePreferencesStore()
  const raster = useRasterStore()

  /** Where a fill would land: the raster layer the cursor is standing on. */
  const target = computed<RasterLayerEntry | null>(() => {
    const id = editor.cursorId
    if (id === null) return null
    const entry = project.entryById(id)
    return entry?.kind === 'raster' ? entry : null
  })

  const canFill = computed(
    () =>
      editor.currentPageId !== null &&
      target.value !== null &&
      selection.bounds !== null &&
      !isEmptyRect(selection.bounds),
  )

  /**
   * Whether this layer may be written to at all, saying why when it may not.
   *
   * Both refusals are about a write whose result could not be seen: a locked
   * layer is one somebody protected, and a hidden one would take the paint and
   * show nothing, which is indistinguishable from the tool being broken.
   */
  function refuse(pageId: string, entry: RasterLayerEntry): boolean {
    const layers = project.pageById(pageId)?.page.layers ?? []
    if (isLocked(layers, entry.id)) {
      notices.say(`「${entry.name}」鎖定中，改不了`)
      return true
    }
    if (isHidden(layers, entry.id)) {
      notices.say(`「${entry.name}」是隱藏的，改不了`)
      return true
    }
    return false
  }

  async function fillSelection(): Promise<void> {
    const page = editor.currentPageId
    if (page === null) return
    const file = project.pageById(page)
    if (!file) return

    const bounds = selection.bounds
    /*
     * The keyboard reaches this with nothing selected — the button is disabled
     * then, the shortcut is not. Silence there reads as a broken key rather
     * than as a fill that had nowhere to go.
     */
    if (bounds === null || isEmptyRect(bounds)) {
      notices.say('沒有選區可以填充')
      return
    }
    const entry = target.value
    if (entry === null) {
      notices.say('選一個點陣圖層再填充')
      return
    }
    if (refuse(page, entry)) return
    const mask = selection.maskPatchOf(page, bounds)
    if (mask === null) return

    // The first edit of this layer, and the only time its whole pixels cross.
    await raster.take(entry, layersDirOf(file.pageDir))

    /*
     * Trimmed before the write allocates, never after. Building the record
     * first and pruning afterwards is how a stack peaks at its ceiling plus a
     * whole canvas — which here is over half a gigabyte at the largest page.
     *
     * The engine decides what goes, because it is the only place that can see a
     * block shared between two records as one block. The stack follows.
     */
    editor.forgetJournals(
      window.engine.rasterTrimHistory(
        preferences.prefs.undoPixelSteps,
        preferences.prefs.undoPixelBytes,
      ),
    )

    const from: LayerPlace = { file: entry.file, x: entry.x, y: entry.y, w: entry.w, h: entry.h }
    const patch = window.engine.rasterFill(
      entry.id,
      new Uint8Array(mask),
      { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
      editor.foreground,
    )
    // A selection that covered nothing, or a fully transparent colour. Neither
    // is a failure and neither is a step.
    if (patch === null) return
    raster.paste(entry.id, patch)

    /*
     * A name nothing else has ever held, on every write. The manifest is
     * written after the pixels it names, so a crash between the two leaves the
     * previous manifest pointing at data that is all still there — which
     * reusing a file name is exactly what would destroy. Whatever no manifest
     * names any more is swept when the project is next opened.
     */
    const to: LayerPlace = {
      file: `${entry.id}.${generateId().slice(0, 8)}.png`,
      ...patch.frame,
    }
    const bytes = await raster.encode(entry.id)
    if (bytes === null) return
    await window.api.writePage(file.pageDir, { layerParts: { [to.file]: bytes } })
    project.placeLayer(page, entry.id, to)

    /*
     * One call for both directions. The engine's record is a swap, so applying
     * it takes the write back and applying it again puts it there — undo and
     * redo differ only in which frame and file the manifest is left pointing at.
     *
     * Both files stay on disk until the project is next opened, which is what
     * lets the manifest side of this be a plain swap rather than an encode.
     */
    const swapTo = (place: LayerPlace) => {
      const back = window.engine.rasterApplyJournal(patch.journal)
      if (back !== null) raster.paste(entry.id, back)
      project.placeLayer(page, entry.id, place)
    }
    editor.pushCommand(
      {
        label: `fill-layer ${entry.id}`,
        journal: patch.journal,
        do: () => swapTo(to),
        undo: () => swapTo(from),
        // Only when this step leaves the stack for good. The layer files it
        // named stay on disk either way — the ceiling bounds memory, and what
        // no manifest names is swept when the project is next opened.
        forget: () => window.engine.rasterDropJournal(patch.journal),
      },
      { alreadyApplied: true },
    )
  }

  return { canFill, fillSelection }
}
