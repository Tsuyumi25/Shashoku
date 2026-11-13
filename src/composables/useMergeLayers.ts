import { computed } from 'vue'
import type {
  LayerEntry,
  RasterLayerEntry,
  TextLayerEntry,
  TranslationUnit,
} from '@shared/page/types'
import { shownCodeOf, unitOfBlock } from '@shared/page/units'
import { linesOf } from '@shared/page/text'
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
import { useProjectStore } from '@/stores/projectStore'

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

  /** A page and the tree it is worked in, with where something new made there belongs; the open one unless named. */
  function openPage(page = editor.currentPageId): { page: string; pageDir: string; layers: readonly LayerEntry[]; home: string | null } | null {
    if (page === null) return null
    const file = project.pageById(page)
    return file ? { page, pageDir: file.pageDir, layers: editor.workingTree(page), home: editor.layerHome() } : null
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

  /** `link` joins the selected text into one sentence in the same step, as Ctrl+E does to text beside pixels. */
  async function merge(parts: MergeableEntry[], link = false): Promise<void> {
    const open = openPage()
    const target = editor.maskTarget
    if (open === null || target === null || parts.length < 2) return

    // Both of these read `layers/` for the pixels they consume, and pixels
    // reach disk on a scheduler of their own — merging a layer that was painted
    // on a moment ago would flatten the version before the paint.
    await project.flush()

    // Hiding is inherited and `pageStack` honours it, so a hidden participant
    // contributes nothing and is still consumed — as merging does anywhere.
    const nodes = pageStack(parts, 'translation', project.activeFace)
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
    let linked: string[] | null = null
    const label = `merge-layers ${parts.length}${link ? ' link' : ''}`
    editor.cmdReshape(label, open.page, () => {
      for (const id of below) project.removeEntry(id)
      // Read after the others are gone, so it still says where the topmost
      // sits — which is where the result belongs.
      const at = pathOf(editor.workingTree(open.page), top.id) ?? undefined
      project.removeEntry(top.id)
      project.addLayer(open.page, open.home, merged, at)
      if (link) linked = editor.linkSelectionInPlace()
    })
    editor.selectOnly(merged.id)
    for (const id of linked ?? []) editor.toggleSelected(id)
  }

  const mergeSelection = () => merge(selectionParts())
  const mergeDown = () => merge(downParts())

  /**
   * Ctrl+E. Pixels and text are two merges that do not reduce to one: one
   * layer merges down and several merge together, as Photoshop's one key
   * does, and the selected text joins one sentence. Both in one step.
   */
  async function mergeBySelection(): Promise<void> {
    const link = editor.linkPlan().kind !== 'none'
    const parts = editor.selectedIds.size > 1 ? selectionParts() : downParts()
    if (parts.length >= 2) return merge(parts, link)
    if (link) editor.cmdLinkSelection()
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
   *
   * ⚠️ Everything a node owns is copied, not shared. A spread alone leaves the
   * copy and its original holding one body and one list of effects between
   * them: dragging either would move both, typing into either would write into
   * both, and what looked like two objects would be one wearing two ids.
   *
   * Lettering brings its proposals only with `withDrawer`. Without, the copy's
   * own words are what the original reads as, so it says the same thing.
   */
  function cloneEntry(entry: LayerEntry, into: Clone, withDrawer: boolean): LayerEntry {
    const id = generateId()
    const effects = cloneEffects(entry.effects)
    if (entry.kind === 'raster') {
      const file = `${id}${entry.file.slice(entry.file.lastIndexOf('.'))}`
      if (entry.w > 0 && entry.h > 0) into.files.push({ from: entry.file, to: file })
      return { ...entry, id, file, effects }
    }
    if (entry.kind === 'text') {
      into.texts.push([entry.id, id])
      const own = { lines: [...entry.body.lines], style: { ...entry.body.style } }
      if (entry.side === 'source') {
        return { ...entry, id, effects, body: { ...entry.body, ...own, tags: [...entry.body.tags] } }
      }
      const body = { ...entry.body, ...own }
      if (!withDrawer) {
        return { ...entry, id, effects, body: { ...body, lines: linesOf(shownCodeOf(entry)), candidates: [], chosen: null } }
      }
      const ids = new Map(entry.body.candidates.map((c) => [c.id, generateId()]))
      return {
        ...entry,
        id,
        effects,
        body: {
          ...body,
          candidates: entry.body.candidates.map((c) => ({ ...c, id: ids.get(c.id)!, lines: [...c.lines] })),
          chosen: entry.body.chosen === null ? null : (ids.get(entry.body.chosen) ?? null),
        },
      }
    }
    return {
      ...entry,
      id,
      effects,
      children: entry.children.map((c) => cloneEntry(c, into, withDrawer)),
    }
  }

  const canDuplicate = computed(() => {
    const open = openPage()
    const id = editor.cursorId
    if (open === null || id === null) return false
    return pathOf(open.layers, id) !== null
  })

  /**
   * A whole sentence copied, in the face being worked on: every block it holds
   * gets a twin, drawer and all, and the twins make a new sentence of their
   * own, read right after the original.
   */
  function copyUnits(
    page: string,
    clone: Clone,
  ): { units: Array<{ of: string; unit: TranslationUnit }>; extra: TextLayerEntry[] } {
    const view = project.viewOf(page)
    if (!view) return { units: [], extra: [] }
    const twin = new Map(clone.texts)
    const units: Array<{ of: string; unit: TranslationUnit }> = []
    const extra: TextLayerEntry[] = []
    for (const [was] of clone.texts) {
      const unit = unitOfBlock(view, was)
      if (!unit || units.some((u) => u.of === unit.id)) continue
      for (const id of unit.members) {
        if (twin.has(id)) continue
        const block = project.blockById(page, id)
        if (!block) continue
        const copy = cloneEntry(block, clone, true) as TextLayerEntry
        twin.set(id, copy.id)
        extra.push(copy)
      }
      units.push({ of: unit.id, unit: { id: generateId(), members: unit.members.flatMap((id) => twin.get(id) ?? []) } })
    }
    return { units, extra }
  }

  /**
   * ⭐ A text block's copy is another block of the same sentence, read right
   * after the one it copies and saying the same words — Ctrl+J and Alt with a
   * drag both copy what was pressed and nothing else. `wholeUnit` is the other
   * question, a second sentence copied whole, asked from the object's menu.
   *
   * `id` names what to copy when it is not the cursor; `keepSelection` leaves
   * the selection where it is rather than moving it onto the copy — Alt and a
   * drag goes on holding what the hand pressed.
   */
  async function duplicateLayer(
    opts: { id?: string; keepSelection?: boolean; wholeUnit?: boolean } = {},
  ): Promise<void> {
    const id = opts.id ?? editor.cursorId
    // Where the object named lives, which an object's menu on the shelf can be opened on from another page.
    const open = openPage(opts.id === undefined ? editor.currentPageId : project.pageOfEntry(opts.id))
    if (open === null || id === null) return
    const path = pathOf(open.layers, id)
    const source = project.entryById(id)
    if (path === null || source === undefined) return

    const clone: Clone = { entry: source, files: [], texts: [] }
    const copy = cloneEntry(source, clone, opts.wholeUnit === true)
    if (copy.kind !== 'group') copy.locked = false
    const { units, extra } = opts.wholeUnit
      ? copyUnits(open.page, clone)
      : { units: [], extra: [] as TextLayerEntry[] }

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

    editor.cmdReshape(`duplicate-layer ${copy.id}`, open.page, () => {
      project.addLayer(open.page, open.home, copy, at)
      if (!opts.wholeUnit) {
        for (const [was, now] of clone.texts) project.addMemberAfter(open.page, was, now)
      }
      // The sentence's other twins, each above the block it copies.
      for (const block of extra) {
        const near = pathOf(editor.workingTree(open.page), originals.get(block.id) ?? '')
        project.addLayer(open.page, open.home, block, near === null ? undefined : [...near.slice(0, -1), near[near.length - 1] + 1])
      }
      for (const { of, unit } of units) project.insertUnit(open.page, unit, of)
    })
    if (!opts.keepSelection) editor.selectOnly(copy.id)
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
