import { computed } from 'vue'
import type {
  LayerEntry,
  RasterLayerEntry,
  TextLayerEntry,
  TranslationUnit,
} from '@shared/page/types'
import { unitOfBlock } from '@shared/page/units'
import { generateId } from '@shared/page/schema'
import { cloneEffects } from '@shared/effects/clone'
import { pageStack } from '@shared/page/stack'
import { isMergeable, pathOf } from '@shared/page/tree'
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
  encodePng,
  hasPixels,
  rasterNodes,
} from '@/lib/pageComposite'
import { effectedFrame } from '@/lib/layerEffects'
import { EMPTY_RECT, clampToPage, isEmptyRect, unionRect, type Rect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore, type RemovedEntry, type RemovedTranslation } from '@/stores/projectStore'

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
    const page = editor.currentPageId
    if (page === null) return null
    const file = project.pageById(page)
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

  /**
   * The box the merged pixels land in: what the sources cover, and no more.
   *
   * A source carrying effects covers more than its own frame — the band reaches
   * past it — and merging is where those stop being composited and become
   * pixels. A box drawn from the frames alone would shave the band off in the
   * one step that makes it permanent.
   */
  function frameOf(nodes: ReturnType<typeof pageStack>, page: { w: number; h: number }): Rect {
    let box: Rect = EMPTY_RECT
    for (const node of rasterNodes(nodes)) {
      if (!hasPixels(node)) continue
      const { x, y, w, h } = node.entry
      box = unionRect(box, effectedFrame({ x, y, w, h }, node.entry.effects))
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
      return await encodePng(canvas)
    } finally {
      for (const bitmap of rasters.values()) bitmap.close()
    }
  }

  async function merge(parts: MergeableEntry[]): Promise<void> {
    const open = openPage()
    const target = editor.maskTarget
    if (open === null || target === null || parts.length < 2) return

    // Both of these read `layers/` for the pixels they consume, and pixels
    // reach disk on a scheduler of their own — merging a layer that was painted
    // on a moment ago would flatten the version before the paint.
    await project.flush()

    // Hiding is inherited and `pageStack` honours it, so a hidden participant
    // contributes nothing and is still consumed — as merging does anywhere.
    const nodes = pageStack(parts, 'translation')
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
      effects: [],
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
  /**
   * ⚠️ Everything a node owns is copied, not shared. A spread alone leaves the
   * copy and its original holding one body and one list of effects between
   * them: dragging either would move both, typing into either would write into
   * both, and what looked like two objects would be one wearing two ids.
   */
  function cloneEntry(entry: LayerEntry, into: Clone): LayerEntry {
    const id = generateId()
    const effects = cloneEffects(entry.effects)
    if (entry.kind === 'raster') {
      const file = `${id}${entry.file.slice(entry.file.lastIndexOf('.'))}`
      if (entry.w > 0 && entry.h > 0) into.files.push({ from: entry.file, to: file })
      return { ...entry, id, file, effects }
    }
    if (entry.kind === 'text') {
      into.texts.push([entry.id, id])
      const body = { ...entry.body, lines: [...entry.body.lines], style: { ...entry.body.style } }
      return entry.side === 'source'
        ? { ...entry, id, effects, side: 'source', body: { ...body, by: entry.body.by } }
        : { ...entry, id, effects, side: 'translation', body }
    }
    return {
      ...entry,
      id,
      effects,
      children: entry.children.map((c) => cloneEntry(c, into)),
    }
  }

  const canDuplicate = computed(() => {
    const open = openPage()
    const id = editor.cursorId
    if (open === null || id === null) return false
    return pathOf(open.layers, id) !== null
  })

  /**
   * A whole translation copied, both sides: every block it holds gets a twin and
   * the twins make a new unit of their own, read right after the original.
   *
   * ⭐ A copy is another translation, independent of the first. The words come
   * with it — the proposals and which one is chosen are the unit's, not the
   * block's, so copying only the block would leave a copy with nothing to say.
   */
  function copyUnits(
    page: string,
    clone: Clone,
  ): { units: Array<{ of: string; unit: TranslationUnit }>; extra: TextLayerEntry[] } {
    const file = project.pageById(page)
    if (!file) return { units: [], extra: [] }
    const twin = new Map(clone.texts)
    const units: Array<{ of: string; unit: TranslationUnit }> = []
    const extra: TextLayerEntry[] = []
    for (const [was] of clone.texts) {
      const unit = unitOfBlock(file.page, was)
      if (!unit || units.some((u) => u.of === unit.id)) continue
      for (const id of [...unit.source.members, ...unit.translation.members]) {
        if (twin.has(id)) continue
        const block = project.blockById(page, id)
        if (!block) continue
        const copy = cloneEntry(block, clone) as TextLayerEntry
        twin.set(id, copy.id)
        extra.push(copy)
      }
      const chosen = new Map(unit.candidates.map((c) => [c.id, generateId()]))
      const side = (s: TranslationUnit['source']) => ({
        members: s.members.flatMap((id) => twin.get(id) ?? []),
        separators: [...s.separators],
      })
      const copy: TranslationUnit = {
        id: generateId(),
        tags: [...unit.tags],
        source: side(unit.source),
        translation: side(unit.translation),
        candidates: unit.candidates.map((c) => ({
          ...c,
          id: chosen.get(c.id)!,
          pieces: c.pieces.map((piece) => [...piece]),
        })),
        chosen: unit.chosen === null ? null : (chosen.get(unit.chosen) ?? null),
      }
      units.push({ of: unit.id, unit: copy })
    }
    return { units, extra }
  }

  async function duplicateLayer(): Promise<void> {
    const open = openPage()
    const id = editor.cursorId
    if (open === null || id === null) return
    const path = pathOf(open.layers, id)
    const source = project.entryById(id)
    if (path === null || source === undefined) return

    const clone: Clone = { entry: source, files: [], texts: [] }
    const copy = cloneEntry(source, clone)
    if (copy.kind !== 'group') copy.locked = false
    const { units, extra } = copyUnits(open.page, clone)

    if (clone.files.length > 0) {
      await project.flush()
      const dir = layersDirOf(open.pageDir)
      const parts: Record<string, Uint8Array> = {}
      for (const { from, to } of clone.files) parts[to] = await window.api.readImage(dir, from)
      await window.api.writePage(open.pageDir, { layerParts: parts })
    }

    // Directly above the original, which is where every panel puts a copy.
    const at = [...path.slice(0, -1), path[path.length - 1] + 1]
    const originals = new Map(clone.texts.map(([was, now]) => [now, was]))

    let removed: RemovedEntry | null = null
    let leftovers: RemovedTranslation[] = []
    editor.pushCommand({
      label: `duplicate-layer ${copy.id}`,
      do: () => {
        if (removed === null) {
          project.addLayer(open.page, copy, at)
          // The other side's twins, each above the block it copies.
          for (const block of extra) {
            const live = project.pageById(open.page)?.page.layers ?? []
            const near = pathOf(live, originals.get(block.id) ?? '')
            project.addLayer(
              open.page,
              block,
              near === null ? undefined : [...near.slice(0, -1), near[near.length - 1] + 1],
            )
          }
          for (const { of, unit } of units) {
            const order = project.pageById(open.page)?.page.readingOrder ?? []
            const after = order.indexOf(of)
            project.addLabel(
              open.page,
              { unit, blocks: [] },
              { paths: [], orderIndex: after === -1 ? order.length : after + 1, edges: [] },
            )
          }
        } else {
          for (const gone of leftovers) {
            project.addLabel(
              open.page,
              { unit: gone.unit, blocks: gone.blocks.map((b) => b.entry) },
              { paths: gone.blocks.map((b) => b.path), orderIndex: gone.orderIndex, edges: gone.edges },
            )
          }
          project.restoreEntry(removed)
        }
      },
      undo: () => {
        removed = project.removeEntry(copy.id)
        // A twin unit with blocks outside the copied entry is still standing.
        leftovers = units.flatMap(({ unit }) => project.deleteLabel(open.page, unit.id) ?? [])
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
