import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { GroupLayerEntry, TextLayerEntry } from '@shared/page/types'
import { useZoomPan, type Size } from '@/composables/useZoomPan'
import { useProjectStore, type LabelPlace, type RemovedEntry } from '@/stores/projectStore'
import { screenToPageFraction } from '@/lib/coords'
import { generateId as generateLabelId } from '@shared/page/schema'
import { textOf } from '@shared/page/text'
import { textObjects } from '@shared/page/tree'
import { flattenLayerRows } from '@/lib/layerRows'
import { buildLabelRows, chapterStops, type ChapterRow } from '@/lib/labelRows'
import type { MaskTarget } from '@/lib/selection/mask'
import type { DropTarget } from '@shared/page/tree'

export interface Command {
  
  label: string
  do(): void
  undo(): void
}

/**
 * Sticky, as in Photoshop: the text tool stays until V takes it back. The
 * canvas's other gestures are held rather than toggled, which is why the
 * bottom bar has to say which tool is up — a cursor shape is gone the moment
 * the pointer leaves the canvas.
 *
 * The tool is also the mode. A drag on bare page can mean select a region or
 * place a text box, and that collision is the only thing that would otherwise
 * force separate workspaces; picking a tool answers it.
 */
export type CanvasTool =
  | 'select'
  | 'text'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'lasso-polygon'
  | 'wand'
  | 'brush'

/** The tools whose drag builds a selection rather than acting on objects. */
export const SELECTION_TOOLS = [
  'marquee-rect',
  'marquee-ellipse',
  'lasso',
  'lasso-polygon',
  'wand',
  'brush',
] as const satisfies readonly CanvasTool[]

export function isSelectionTool(tool: CanvasTool): boolean {
  return (SELECTION_TOOLS as readonly CanvasTool[]).includes(tool)
}


export const useEditorStore = defineStore('editor', () => {
  const currentFilename = ref<string | null>(null)

  /**
   * One selection, held as a set with a cursor into it — never two selections
   * that have to be kept in step.
   *
   * Any entry can be in it, folders and rasters included: the tree has to be
   * operable by keyboard too, and a second selection for the things the canvas
   * cannot draw is the shape this exists to avoid. Each reader decides what to
   * do with a member it has no way to show.
   *
   * The cursor is whichever entry was touched last. It is what the canvas
   * turns the page to follow and what a single-entry command acts on; the set
   * is what every surface outlines. An empty selection has no cursor, and the
   * cursor is always in the set otherwise.
   */
  const selectedIds = ref<Set<string>>(new Set())
  const cursorId = ref<string | null>(null)

  /**
   * Where a range reaches from.
   *
   * Set by anything that names a single object — a plain click, a keyboard
   * step, an object added — and deliberately left alone by extending, so that
   * a run of Shift clicks all measure from the same place. Measuring from the
   * cursor instead would chain each range onto the end of the last, and the
   * selection would creep away from where it began.
   */
  const anchorId = ref<string | null>(null)

  function selectOnly(labelId: string | null) {
    cursorId.value = labelId
    anchorId.value = labelId
    selectedIds.value = labelId === null ? new Set() : new Set([labelId])
  }

  function isSelected(labelId: string): boolean {
    return selectedIds.value.has(labelId)
  }

  /**
   * Turn to the page an object lives on. Building a selection carries this
   * second duty: a selection reaches across pages, so the click that reaches
   * another one is also what says to go and look at it.
   *
   * Driven by what was clicked rather than by where the cursor ends up. Taking
   * an object back out of the selection moves the cursor to some other member,
   * which may be pages away — and throwing the view there would leave the
   * person looking at somewhere they did not point at.
   */
  function showPageOf(id: string) {
    const page = useProjectStore().pageOfEntry(id)
    if (page !== null) showPage(page)
  }

  /**
   * Turn to a page without touching what is selected on it — what an undo needs
   * when the command it is taking back happened somewhere you have since navigated
   * away from. `selectFile` lands on the page's first object, which would make
   * undoing a change on page 3 also move the cursor.
   */
  function showPage(filename: string) {
    if (filename === currentFilename.value) return
    commitTextEdit()
    currentFilename.value = filename
  }

  /** One entry in or out, leaving the rest alone. */
  function toggleSelected(id: string) {
    const next = new Set(selectedIds.value)
    if (next.delete(id)) {
      // The cursor is a place inside the selection, so it cannot be left
      // pointing at something that is no longer in it.
      if (cursorId.value === id) cursorId.value = next.values().next().value ?? null
    } else {
      next.add(id)
      cursorId.value = id
    }
    selectedIds.value = next
    anchorId.value = id
    showPageOf(id)
  }

  /**
   * Everything from the cursor to where the pointer landed, in the order the
   * panel is showing — which the caller passes in, because what counts as a
   * range is the list's question and not this store's.
   */
  function extendSelectionTo(id: string, sequence: readonly string[]) {
    const to = sequence.indexOf(id)
    if (to === -1) return
    const anchor = anchorId.value ?? cursorId.value
    const from = anchor === null ? -1 : sequence.indexOf(anchor)
    if (from === -1) {
      selectOnly(id)
      return
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    selectedIds.value = new Set(sequence.slice(lo, hi + 1))
    cursorId.value = id
    showPageOf(id)
  }

  /**
   * What the label list is being narrowed to. Held here because moving up and
   * down has to walk what is on screen, and what is on screen is whatever
   * survived this.
   */
  const labelQuery = ref('')

  /** The label list as it is being shown, filter and all. */
  function shownRows(): ChapterRow[] {
    return buildLabelRows(useProjectStore().files, labelQuery.value)
  }

  /**
   * Which folders are closed. Held here rather than in the tree because moving
   * the cursor by keyboard has to know what is on screen, and a folder that is
   * shut has nothing on screen to move onto.
   */
  const collapsedLayerIds = ref<Set<string>>(new Set())

  const tool = ref<CanvasTool>('select')
  
  const activeGroupId = ref<string | null>(null)
  
  const showGroups = ref(false)
  
  const fontSize = ref(14)

  function adjustFontSize(delta: number) {
    fontSize.value = Math.min(24, Math.max(10, fontSize.value + delta))
  }

  function setTool(next: CanvasTool) {
    tool.value = next
  }

  /**
   * The view transform lives here rather than in the canvas because the bottom
   * bar is the canvas's sibling, and because whether a page change keeps the
   * current view is the same kind of question as which page is open.
   */
  const viewContainerSize = ref<Size>({ w: 0, h: 0 })
  const viewContentSize = ref<Size>({ w: 0, h: 0 })
  const { view, fitToView, wheelZoom, zoomBy, panBy, rotateTo } = useZoomPan(
    viewContainerSize,
    viewContentSize,
  )
  /** The page the view was last fitted to, so re-decoding one does not refit. */
  const viewFittedPage = ref<string | null>(null)

  /**
   * The open page as something a selection can be made on — its name together
   * with the raw's own pixel size, which is what a mask is measured in. Null
   * until a page has decoded, since there is nothing to measure before that.
   */
  const maskTarget = computed<MaskTarget | null>(() => {
    const page = currentFilename.value
    const size = viewContentSize.value
    if (page === null || size.w === 0 || size.h === 0) return null
    return { page, w: size.w, h: size.h }
  })

  const undoStack = shallowRef<Command[]>([])
  const redoStack = shallowRef<Command[]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function selectFile(filename: string | null) {
    commitTextEdit()
    currentFilename.value = filename
    
    const project = useProjectStore()
    selectOnly(filename ? (project.labelsOf(filename)[0]?.id ?? null) : null)
  }

  
  function pageBy(offset: number, landOn: 'first' | 'last' = 'first') {
    const project = useProjectStore()
    if (project.files.length === 0) return
    const index = project.files.findIndex((f) => f.filename === currentFilename.value)
    const next = index === -1 ? 0 : index + offset
    if (next < 0 || next >= project.files.length) return
    selectFile(project.files[next].filename)
    if (landOn === 'last') {
      const labels = project.labelsOf(project.files[next].filename)
      selectOnly(labels[labels.length - 1]?.id ?? null)
    }
  }

  /**
   * One row up or down the label list, as it is being shown — so narrowing the
   * list narrows this too, without either having to know about the other.
   *
   * A step lands on an object, or on the heading of a page that has none, which
   * is the only way to reach a page with nothing on it. Pages are crossed on
   * the way rather than turned to deliberately: the list runs on past the end
   * of one page, and so does this.
   */
  function selectLabelBy(offset: number) {
    const stops = chapterStops(shownRows())
    if (stops.length === 0) return

    const at = stops.findIndex((r) =>
      r.kind === 'label'
        ? r.label.id === cursorId.value
        : cursorId.value === null && r.filename === currentFilename.value,
    )
    const next = at === -1 ? (offset > 0 ? 0 : stops.length - 1) : at + offset
    if (next < 0 || next >= stops.length) return

    const row = stops[next]
    if (row.kind === 'label') {
      selectOnly(row.label.id)
      showPageOf(row.label.id)
      return
    }
    commitTextEdit()
    currentFilename.value = row.filename
    selectOnly(null)
  }

  /**
   * One row up or down the layer tree, as the panel draws it — folders that are
   * shut take their contents off the screen, and off this walk with them.
   *
   * The tree is one page's, so its ends are ends: there is no next page to turn
   * to, which is what makes this different from walking the label list.
   */
  function selectLayerBy(offset: number) {
    const project = useProjectStore()
    if (!currentFilename.value) return
    const file = project.fileByName(currentFilename.value)
    if (!file) return
    const rows = flattenLayerRows(file.page.layers, collapsedLayerIds.value)
    if (rows.length === 0) return
    const index = rows.findIndex((r) => r.entry.id === cursorId.value)
    if (index === -1) {
      selectOnly(rows[offset > 0 ? 0 : rows.length - 1].entry.id)
      return
    }
    const next = index + offset
    if (next < 0 || next >= rows.length) return
    selectOnly(rows[next].entry.id)
  }

  /**
   * Land on an object wherever in the chapter it lives — what clicking a row of
   * the label list does.
   *
   * The view is left alone on purpose: the list is read at the scale of the
   * chapter, and a canvas that scrolled and zoomed itself on every click would
   * make reading down it unbearable. `selectFile` lands on the page's first
   * object, so the one asked for has to be put back after the turn.
   */
  function revealLabel(filename: string, labelId: string) {
    if (currentFilename.value !== filename) selectFile(filename)
    selectOnly(labelId)
  }

  /**
   * The translation being typed right now. Every keystroke writes straight
   * through so the page keeps up, and the editing session is what enters the
   * undo stack — the same split the drag gestures use. One entry per label you
   * visited reads as "you edited this line", where a time window would let
   * typing speed decide how much an undo takes back.
   */
  const pendingTextEdit = ref<{ filename: string; labelId: string; from: string } | null>(null)

  /** Undefined once the label being edited has been deleted under the caret. */
  function textOfPending(): string | undefined {
    const pending = pendingTextEdit.value
    if (!pending) return undefined
    const project = useProjectStore()
    const label = project.labelById(pending.filename, pending.labelId)
    return label === undefined ? undefined : textOf(label)
  }

  function beginTextEdit(filename: string, labelId: string, from: string) {
    commitTextEdit()
    pendingTextEdit.value = { filename, labelId, from }
  }

  function commitTextEdit() {
    const pending = pendingTextEdit.value
    if (!pending) return
    const text = textOfPending()
    // Cleared first: the command below re-enters here through pushCommand, and
    // this is what stops it recursing.
    pendingTextEdit.value = null
    // The label was deleted mid-edit, and the delete already captured its text.
    if (text === undefined) return
    cmdUpdateLabelText(pending.filename, pending.labelId, pending.from, text)
  }

  /**
   * Finish this row and open the next one for typing — the loop a chapter is
   * actually translated in, and the reason it is worth a key of its own.
   *
   * Commits before moving: staying on the same page does not go through
   * selectFile, so nothing else would close the visit, and the session would
   * follow the cursor onto a row it was never opened on.
   */
  function editBy(offset: number) {
    commitTextEdit()
    selectLabelBy(offset)
    const page = currentFilename.value
    const id = cursorId.value
    if (page === null || id === null) return
    const label = useProjectStore().labelById(page, id)
    if (!label) return
    beginTextEdit(page, id, textOf(label))
  }

  /**
   * Bank what has been typed without ending the visit, for a save that lands
   * mid-sentence: the undo stack has to agree with what went to disk, and the
   * caret is still in the box.
   */
  function flushTextEdit() {
    const pending = pendingTextEdit.value
    const text = textOfPending()
    commitTextEdit()
    if (!pending || text === undefined) return
    pendingTextEdit.value = { ...pending, from: text }
  }

  /**
   * Every command lands here, so this is where an open text edit is closed:
   * the stack has to run in the order things happened, or undoing a delete
   * after the text change it swallowed replays them the wrong way round.
   */
  function pushCommand(cmd: Command, opts?: { alreadyApplied?: boolean }) {
    commitTextEdit()
    if (!opts?.alreadyApplied) cmd.do()
    undoStack.value = [...undoStack.value, cmd]
    redoStack.value = []
  }

  /**
   * Closed before the stack is read, not after: a session still open is the
   * most recent thing that happened, so it is what an undo has to take back.
   * Reading the stack first would reach past it to some earlier command and
   * leave the typing standing.
   */
  function undo() {
    commitTextEdit()
    const cmd = undoStack.value.at(-1)
    if (!cmd) return
    undoStack.value = undoStack.value.slice(0, -1)
    cmd.undo()
    redoStack.value = [...redoStack.value, cmd]
  }

  /** Typing after an undo ends the redo branch, as it does in any editor. */
  function redo() {
    commitTextEdit()
    const cmd = redoStack.value.at(-1)
    if (!cmd) return
    redoStack.value = redoStack.value.slice(0, -1)
    cmd.do()
    undoStack.value = [...undoStack.value, cmd]
  }

  
  function clearHistory() {
    undoStack.value = []
    redoStack.value = []
    pendingTextEdit.value = null
  }

  

  function cmdAddLabel(filename: string, label: TextLayerEntry) {
    const project = useProjectStore()
    let place: LabelPlace | undefined
    pushCommand({
      label: `add-label ${label.id}`,
      do: () => project.addLabel(filename, label, place),
      undo: () => {
        place = project.deleteLabel(filename, label.id) ?? undefined
      },
    })
    selectOnly(label.id)
  }

  /**
   * A new label is empty and joins the active group, so a run of them can be
   * placed first and typed later.
   */
  function addLabelAt(x: number, y: number) {
    if (!currentFilename.value) return
    cmdAddLabel(currentFilename.value, {
      kind: 'text',
      id: generateLabelId(),
      visible: true,
      locked: false,
      x,
      y,
      groupId: activeGroupId.value,
      rotation: 0,
      lines: [''],
    })
  }

  /**
   * Where the panel's add button drops a label. The view centre is a container
   * coordinate, which is what `screenToPageFraction` wants once the container's
   * own offset is taken out — and it can be off the page after a pan, hence the
   * clamp inside it.
   */
  function addLabelAtViewCenter() {
    const natural = viewContentSize.value
    if (!natural.w || !natural.h) return
    const p = screenToPageFraction(
      viewContainerSize.value.w / 2,
      viewContainerSize.value.h / 2,
      { left: 0, top: 0 },
      view,
      natural,
    )
    addLabelAt(p.x, p.y)
  }

  /** The objects as a reader meets them, so a group dragged stays a group. */
  function inChapterOrder(ids: readonly string[]): string[] {
    const project = useProjectStore()
    const wanted = new Set(ids)
    const out: string[] = []
    for (const file of project.files) {
      for (const id of file.page.readingOrder) if (wanted.has(id)) out.push(id)
    }
    return out
  }

  /**
   * Drop objects into a place in some page's reading order.
   *
   * Within a page this only rearranges what is read first — the tree comes
   * through untouched, because stacking is a separate question and dragging in
   * a list of translations is no way to answer it.
   *
   * Across pages the object really moves: it leaves the page it was on and
   * joins the other one, landing on top of that page's stack. There is nothing
   * to work out about where in the tree it belongs, since reading order says
   * nothing about stacking and a page with folders has no position to translate
   * it into.
   *
   * Undo restores each affected page's order wholesale. The inverse of
   * rearranging a sequence is the sequence it was, and reconstructing that from
   * a list of individual moves would only be the same answer computed twice.
   */
  function moveObjectsTo(ids: readonly string[], page: string, index: number) {
    const project = useProjectStore()
    const moving = inChapterOrder(ids)
    if (moving.length === 0) return

    const touched = new Set<string>([page])
    const incoming: string[] = []
    for (const id of moving) {
      const from = project.pageOfEntry(id)
      if (from === null) continue
      touched.add(from)
      if (from !== page) incoming.push(id)
    }

    const before = new Map<string, string[]>()
    for (const p of touched) {
      before.set(p, [...(project.fileByName(p)?.page.readingOrder ?? [])])
    }

    const wanted = new Set(moving)
    const orders = new Map<string, string[]>()
    for (const [p, order] of before) orders.set(p, order.filter((id) => !wanted.has(id)))

    // The drop was aimed at the order as it stood, so anything leaving from
    // above the target has to be taken back off the index it was counted in.
    const targetBefore = before.get(page) ?? []
    const leavingAbove = targetBefore.slice(0, index).filter((id) => wanted.has(id)).length
    const at = Math.max(0, index - leavingAbove)
    const target = orders.get(page) ?? []
    target.splice(Math.min(at, target.length), 0, ...moving)

    const settled =
      incoming.length === 0 &&
      [...orders].every(([p, order]) => order.join(' ') === before.get(p)?.join(' '))
    if (settled) return

    let removed: RemovedEntry[] = []
    pushCommand({
      label: `move-objects ${moving.length}`,
      do: () => {
        removed = incoming
          .map((id) => project.removeEntry(id))
          .filter((r): r is RemovedEntry => r !== null)
        for (const r of removed) project.appendEntry(page, r.entry)
        for (const [p, order] of orders) project.setReadingOrder(p, [...order])
      },
      undo: () => {
        for (const r of [...removed].reverse()) {
          project.removeEntry(r.entry.id)
          project.restoreEntry(r)
        }
        for (const [p, order] of before) project.setReadingOrder(p, [...order])
      },
    })

    // The canvas follows the cursor, and the cursor may have just emigrated.
    if (cursorId.value !== null && wanted.has(cursorId.value)) currentFilename.value = page
  }

  /**
   * Where the cursor comes to rest, read before anything moves. Its own place
   * if it had one; otherwise the earliest place about to be emptied, so the eye
   * lands where the page changed.
   */
  function landingIndex(page: string, ids: readonly string[]): number {
    const project = useProjectStore()
    const labels = project.labelsOf(page)
    const atCursor = labels.findIndex((l) => l.id === cursorId.value)
    if (atCursor >= 0) return atCursor

    const doomed = new Set<string>()
    for (const id of ids) {
      const entry = project.entryById(id)
      if (entry) for (const t of textObjects([entry])) doomed.add(t.id)
    }
    const first = labels.findIndex((l) => doomed.has(l.id))
    return first >= 0 ? first : 0
  }

  /**
   * Everything selected, in one step of history — selecting five and deleting
   * them is one act, and five entries to undo would say it was five.
   *
   * A folder goes with everything it holds. It carries no style and no meaning
   * of its own, so there is nothing to keep by keeping it.
   *
   * Deleting never turns the page. Whatever is left of the page the cursor was
   * on is where the cursor lands, and a page emptied outright is still the page
   * being looked at.
   */
  function deleteSelection() {
    const project = useProjectStore()
    const ids = [...selectedIds.value]
    if (ids.length === 0) return
    const page = currentFilename.value
    const landing = page === null ? 0 : landingIndex(page, ids)

    let removed: RemovedEntry[] = []
    pushCommand({
      label: `delete-selection ${ids.length}`,
      do: () => {
        removed = ids
          .map((id) => project.removeEntry(id))
          .filter((r): r is RemovedEntry => r !== null)
      },
      // Backwards, so each recorded path still means what it meant when the
      // entry was taken out from under it.
      undo: () => {
        for (const r of [...removed].reverse()) project.restoreEntry(r)
      },
    })

    if (page === null) {
      selectOnly(null)
      return
    }
    const left = project.labelsOf(page)
    selectOnly(left[Math.min(landing, left.length - 1)]?.id ?? null)
  }

  
  function cmdDuplicateLabel(
    filename: string,
    label: TextLayerEntry,
    opts?: { alreadyApplied?: boolean },
  ) {
    const project = useProjectStore()
    let place: LabelPlace | undefined
    pushCommand(
      {
        label: `duplicate-label ${label.id}`,
        do: () => project.addLabel(filename, label, place),
        undo: () => {
          place = project.deleteLabel(filename, label.id) ?? undefined
        },
      },
      opts,
    )
    selectOnly(label.id)
  }


  
  function cmdMoveLabel(
    filename: string,
    labelId: string,
    oldPos: { x: number; y: number },
    newPos: { x: number; y: number },
  ) {
    const project = useProjectStore()
    pushCommand(
      {
        label: `move-label ${labelId}`,
        do: () => project.moveLabel(filename, labelId, newPos.x, newPos.y),
        undo: () => project.moveLabel(filename, labelId, oldPos.x, oldPos.y),
      },
      { alreadyApplied: true },
    )
  }


  function cmdRotateLabel(filename: string, labelId: string, from: number, to: number) {
    if (from === to) return
    const project = useProjectStore()
    pushCommand(
      {
        label: `rotate-label ${labelId}`,
        do: () => project.rotateLabel(filename, labelId, to),
        undo: () => project.rotateLabel(filename, labelId, from),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * Both sides are snapshots of one label's override taken moments apart, so a
   * string compare is enough to tell a drag that ended where it started from
   * one that moved — which is what keeps a corner nudged and put back out of
   * the undo stack.
   */
  function cmdUpdateLabelStyleOverride(
    filename: string,
    labelId: string,
    from: TextLayerEntry['styleOverride'],
    to: TextLayerEntry['styleOverride'],
  ) {
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return
    const project = useProjectStore()
    pushCommand(
      {
        label: `style-override ${labelId}`,
        do: () => project.updateLabelStyleOverride(filename, labelId, to),
        undo: () => project.updateLabelStyleOverride(filename, labelId, from),
      },
      { alreadyApplied: true },
    )
  }

  function cmdAddFolder(filename: string, name: string) {
    const project = useProjectStore()
    const folder: GroupLayerEntry = {
      kind: 'group',
      id: generateLabelId(),
      name,
      visible: true,
      locked: false,
      children: [],
    }
    let path: number[] | undefined
    pushCommand({
      label: `add-folder ${folder.id}`,
      do: () => project.addFolder(filename, folder, path),
      undo: () => {
        const removed = project.dissolveFolder(filename, folder.id)
        path = removed?.path
      },
    })
  }

  /**
   * Dissolving rather than deleting: a folder is pure containment, so taking
   * one away has to leave what it held behind. There is no way to lose a
   * translation by tidying up.
   */
  function cmdDissolveFolder(filename: string, folderId: string) {
    const project = useProjectStore()
    const removed = project.dissolveFolder(filename, folderId)
    if (removed === null) return
    pushCommand(
      {
        label: `dissolve-folder ${folderId}`,
        do: () => project.dissolveFolder(filename, folderId),
        undo: () => project.restoreFolder(filename, removed.path, removed.folder),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * Applied first so a refused drop — a folder aimed into itself — never
   * reaches the stack as an entry that undoes to nothing.
   */
  function cmdMoveLayer(
    filename: string,
    layerId: string,
    fromPath: number[],
    target: DropTarget,
  ) {
    const project = useProjectStore()
    if (!project.moveLayer(filename, fromPath, target)) return
    pushCommand(
      {
        label: `move-layer ${layerId}`,
        do: () => project.moveLayer(filename, fromPath, target),
        undo: () => project.restoreLayerAt(filename, layerId, fromPath),
      },
      { alreadyApplied: true },
    )
  }

  function cmdSetLayerVisible(filename: string, layerId: string, visible: boolean) {
    const project = useProjectStore()
    pushCommand({
      label: `set-visible ${layerId}`,
      do: () => project.setLayerVisible(filename, layerId, visible),
      undo: () => project.setLayerVisible(filename, layerId, !visible),
    })
  }

  function cmdUpdateLabelText(filename: string, labelId: string, oldText: string, newText: string) {
    if (oldText === newText) return
    const project = useProjectStore()
    pushCommand({
      label: `update-text ${labelId}`,
      do: () => project.updateLabelText(filename, labelId, newText),
      undo: () => project.updateLabelText(filename, labelId, oldText),
    })
  }

  function cmdUpdateLabelGroupId(
    filename: string,
    labelId: string,
    oldGroupId: string | null,
    newGroupId: string | null,
  ) {
    if (oldGroupId === newGroupId) return
    const project = useProjectStore()
    pushCommand({
      label: `update-groupId ${labelId}`,
      do: () => project.updateLabelGroupId(filename, labelId, newGroupId),
      undo: () => project.updateLabelGroupId(filename, labelId, oldGroupId),
    })
  }

  
  function cmdAddGroup(name: string): boolean {
    const project = useProjectStore()
    const added = project.addGroup(name)
    if (added === null) return false
    pushCommand(
      {
        label: `add-group ${name}`,
        do: () => project.restoreLastGroup(added),
        undo: () => {
          
          project.removeLastGroup()
        },
      },
      { alreadyApplied: true },
    )
    return true
  }

  function cmdRenameGroup(index: number, oldName: string, newName: string) {
    if (oldName === newName) return
    const project = useProjectStore()
    pushCommand({
      label: `rename-group ${index}`,
      do: () => project.renameGroup(index, newName),
      undo: () => project.renameGroup(index, oldName),
    })
  }

  return {
    currentFilename,
    selectedIds,
    cursorId,
    showPage,
    selectOnly,
    isSelected,
    toggleSelected,
    extendSelectionTo,
    collapsedLayerIds,
    labelQuery,
    tool,
    setTool,
    activeGroupId,
    showGroups,
    fontSize,
    adjustFontSize,
    view,
    viewContainerSize,
    viewContentSize,
    viewFittedPage,
    maskTarget,
    fitToView,
    wheelZoom,
    zoomBy,
    panBy,
    rotateTo,
    canUndo,
    canRedo,
    selectFile,
    pageBy,
    selectLabelBy,
    selectLayerBy,
    revealLabel,
    pendingTextEdit,
    beginTextEdit,
    commitTextEdit,
    flushTextEdit,
    editBy,
    pushCommand,
    undo,
    redo,
    clearHistory,
    addLabelAt,
    addLabelAtViewCenter,
    deleteSelection,
    moveObjectsTo,
    cmdAddLabel,
    cmdDuplicateLabel,
    cmdMoveLabel,
    cmdRotateLabel,
    cmdUpdateLabelStyleOverride,
    cmdAddFolder,
    cmdDissolveFolder,
    cmdMoveLayer,
    cmdSetLayerVisible,
    cmdUpdateLabelText,
    cmdUpdateLabelGroupId,
    cmdAddGroup,
    cmdRenameGroup,
  }
})
