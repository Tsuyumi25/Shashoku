import { computed } from 'vue'
import type { LayerEntry, RasterLayerEntry } from '@shared/page/types'
import { generateId } from '@shared/page/schema'
import { pageStack } from '@shared/page/stack'
import { isMergeable, pathOf, textObjects } from '@shared/page/tree'
import {
  mergeDownPair,
  mergeParticipants,
  type MergeableEntry,
  type Takeable,
} from '@/lib/mergeTargets'
import { layersDirOf } from '@shared/ssk/constants'
import {
  context2d,
  decodeLayerBitmaps,
  drawStack,
  hasPixels,
  rasterNodes,
} from '@/lib/pageComposite'
import { EMPTY_RECT, clampToPage, isEmptyRect, unionRect, type Rect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore, type RemovedEntry } from '@/stores/projectStore'

/**
 * Merging layers, and duplicating one.
 *
 * Merge exists to turn several appearances into one surface that can still be
 * worked on: a folder gives you a stack, and a brush stroke across it lands on
 * one child. That is why it takes pixels and only pixels — nobody paints across
 * a translation, and a text object consumed here would leave the reading order
 * and vanish from the label list, which is the same object seen from another
 * view.
 *
 * The pixels come out of the same `drawStack` the export composites a page
 * with, reading the same `pageStack` order. Two answers to "what does this
 * stack look like" is the drift the shared order exists to prevent.
 */
export function useMergeLayers() {
  const project = useProjectStore()
  const editor = useEditorStore()

  function openPage(): { page: string; pageDir: string; layers: LayerEntry[] } | null {
    const page = editor.currentFilename
    if (page === null) return null
    const file = project.fileByName(page)
    return file ? { page, pageDir: file.pageDir, layers: file.page.layers } : null
  }

  /** The tree says what may be flattened; the editor says what may be touched. */
  const takeable = ((entry: LayerEntry): entry is MergeableEntry =>
    isMergeable(entry) && !editor.isLayerLocked(entry.id)) as Takeable

  function selectionParts(): MergeableEntry[] {
    const open = openPage()
    return open === null ? [] : mergeParticipants(open.layers, editor.selectedIds, takeable)
  }

  function downParts(): MergeableEntry[] {
    const open = openPage()
    const id = editor.cursorId
    return open === null || id === null ? [] : mergeDownPair(open.layers, id, takeable)
  }

  const canMergeSelection = computed(() => selectionParts().length >= 2)
  const canMergeDown = computed(() => downParts().length === 2)

  /** The box the merged pixels land in: what the sources cover, and no more. */
  function frameOf(nodes: ReturnType<typeof pageStack>, page: { w: number; h: number }): Rect {
    let box: Rect = EMPTY_RECT
    for (const node of rasterNodes(nodes)) {
      if (!hasPixels(node)) continue
      const { x, y, w, h } = node.entry
      box = unionRect(box, { x, y, w, h })
    }
    return clampToPage(box, page.w, page.h)
  }

  async function encodeFrame(
    nodes: ReturnType<typeof pageStack>,
    frame: Rect,
    page: { w: number; h: number },
    pageDir: string,
  ): Promise<Uint8Array> {
    const rasters = await decodeLayerBitmaps(nodes, (name) =>
      window.api.readImage(layersDirOf(pageDir), name),
    )
    try {
      const canvas = new OffscreenCanvas(frame.w, frame.h)
      const ctx = context2d(canvas)
      // Drawn in page coordinates with the frame's corner as the origin, so
      // every layer keeps the position it already had.
      ctx.translate(-frame.x, -frame.y)
      drawStack(ctx, nodes, {
        page,
        rasters,
        drawText: () => {
          throw new Error('merge reached a text object, which it never takes')
        },
      })
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      return new Uint8Array(await blob.arrayBuffer())
    } finally {
      for (const bitmap of rasters.values()) bitmap.close()
    }
  }

  async function merge(parts: MergeableEntry[]): Promise<void> {
    const open = openPage()
    const target = editor.maskTarget
    if (open === null || target === null || parts.length < 2) return

    // Hiding is inherited and `pageStack` honours it, so a hidden participant
    // contributes nothing and is still consumed — as merging does anywhere.
    const nodes = pageStack(parts)
    const page = { w: target.w, h: target.h }
    const frame = frameOf(nodes, page)

    const file = `${generateId()}.png`
    if (!isEmptyRect(frame)) {
      const bytes = await encodeFrame(nodes, frame, page, open.pageDir)
      await window.api.writePage(open.pageDir, { layerParts: { [file]: bytes } })
    }

    // The topmost participant's name and position. Photoshop's merge down keeps
    // the lower layer's name while merge selected keeps the upper one's; taking
    // the upper one in both is one rule instead of two.
    const top = parts[parts.length - 1]
    const merged: RasterLayerEntry = {
      kind: 'raster',
      id: generateId(),
      name: top.name,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      file,
      x: frame.x,
      y: frame.y,
      w: frame.w,
      h: frame.h,
      alphaLocked: false,
    }

    const below = parts.slice(0, -1).map((e) => e.id)
    let removed: RemovedEntry[] = []
    editor.pushCommand({
      label: `merge-layers ${parts.length}`,
      do: () => {
        removed = below
          .map((id) => project.removeEntry(id))
          .filter((r): r is RemovedEntry => r !== null)
        // Read after the others are gone, so it still says where the topmost
        // sits — which is where the result belongs.
        const at = pathOf(open.layers, top.id) ?? undefined
        const taken = project.removeEntry(top.id)
        if (taken !== null) removed.push(taken)
        project.addLayer(open.page, merged, at)
      },
      // Backwards, so each recorded path still means what it meant when the
      // entry was taken out from under it.
      undo: () => {
        project.removeEntry(merged.id)
        for (const r of [...removed].reverse()) project.restoreEntry(r)
      },
    })
    editor.selectOnly(merged.id)
  }

  const mergeSelection = () => merge(selectionParts())
  const mergeDown = () => merge(downParts())

  /**
   * Whichever of the two the selection is asking for, as Photoshop's one key
   * does: several selected means merge those, one means merge it down.
   */
  function mergeBySelection(): Promise<void> {
    return editor.selectedIds.size > 1 ? mergeSelection() : mergeDown()
  }

  const canMerge = computed(() =>
    editor.selectedIds.size > 1 ? canMergeSelection.value : canMergeDown.value,
  )

  // ---- duplicate -----------------------------------------------------------

  interface Clone {
    entry: LayerEntry
    /** Layer files to copy, so the two entries never share one on disk. */
    files: Array<{ from: string; to: string }>
    /** Old id → new id, for the reading order each copied translation needs. */
    texts: Array<[string, string]>
  }

  /**
   * A copy that shares nothing with the original. New ids throughout, and a
   * layer file of its own — two entries naming one file would let deleting
   * either of them take the other's pixels with it when orphans are swept.
   */
  function cloneEntry(entry: LayerEntry, into: Clone): LayerEntry {
    const id = generateId()
    if (entry.kind === 'raster') {
      const file = `${id}.png`
      if (entry.w > 0 && entry.h > 0) into.files.push({ from: entry.file, to: file })
      return { ...entry, id, file }
    }
    if (entry.kind === 'text') {
      into.texts.push([entry.id, id])
      return { ...entry, id }
    }
    return { ...entry, id, children: entry.children.map((c) => cloneEntry(c, into)) }
  }

  const canDuplicate = computed(() => {
    const open = openPage()
    const id = editor.cursorId
    if (open === null || id === null) return false
    return pathOf(open.layers, id) !== null && !editor.isLayerLocked(id)
  })

  async function duplicateLayer(): Promise<void> {
    const open = openPage()
    const id = editor.cursorId
    if (open === null || id === null || editor.isLayerLocked(id)) return
    const path = pathOf(open.layers, id)
    const source = project.entryById(id)
    if (path === null || source === undefined) return

    const clone: Clone = { entry: source, files: [], texts: [] }
    const copy = cloneEntry(source, clone)

    if (clone.files.length > 0) {
      const dir = layersDirOf(open.pageDir)
      const parts: Record<string, Uint8Array> = {}
      for (const { from, to } of clone.files) parts[to] = await window.api.readImage(dir, from)
      await window.api.writePage(open.pageDir, { layerParts: parts })
    }

    // Directly above the original, which is where every panel puts a copy.
    const at = [...path.slice(0, -1), path[path.length - 1] + 1]

    /** Each copied translation follows the one it came from, so reading order survives. */
    const order = [...(project.fileByName(open.page)?.page.readingOrder ?? [])]
    for (const [was, now] of clone.texts) {
      const found = order.indexOf(was)
      order.splice(found === -1 ? order.length : found + 1, 0, now)
    }

    let removed: RemovedEntry | null = null
    editor.pushCommand({
      label: `duplicate-layer ${copy.id}`,
      do: () => {
        if (removed === null) {
          project.addLayer(open.page, copy, at)
          if (textObjects([copy]).length > 0) project.setReadingOrder(open.page, [...order])
        } else {
          project.restoreEntry(removed)
        }
      },
      undo: () => {
        removed = project.removeEntry(copy.id)
      },
    })
    editor.selectOnly(copy.id)
  }

  return {
    canMerge,
    canMergeSelection,
    canMergeDown,
    canDuplicate,
    mergeBySelection,
    mergeSelection,
    mergeDown,
    duplicateLayer,
  }
}
