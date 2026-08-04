import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type {
  GroupLayerEntry,
  LayerEntry,
  RasterLayerEntry,
  TextLayerEntry,
} from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import { useZoomPan, type Size } from '@/composables/useZoomPan'
import { useProjectStore, type LabelPlace, type RemovedEntry } from '@/stores/projectStore'
import { screenToPagePx } from '@/lib/coords'
import { generateId as generateLabelId } from '@shared/page/schema'
import { textOf } from '@shared/page/text'
import { allEntries, folderAtPath, isLocked, textObjects } from '@shared/page/tree'
import { flattenLayerRows } from '@/lib/layerRows'
import type { LayerPlace } from '@/lib/layerTransform'
import { buildLabelRows, chapterStops, type ChapterRow } from '@/lib/labelRows'
import type { MaskBrushMode } from '@/lib/selection/brushMask'
import type { MaskTarget } from '@/lib/selection/mask'
import type { DropTarget } from '@shared/page/tree'
import type { TextStyle } from '@shared/text-style/types'
import { applyStylePatch, type StyledState } from '@shared/text-style/batch'
import { sameTagSet, withTag, withoutTag } from '@shared/tags/set'

export interface Command {

  label: string
  do(): void
  undo(): void
}

/** Everything a corner drag leaves changed about one label. */
export interface ScaledLabel extends StyledState {
  x: number
  y: number
}

/** Everything the rotation handle leaves changed about one label. */
export interface TurnedLabel {
  rotation: number
  x: number
  y: number
}

/**
 * How far back the stack reaches.
 *
 * It was unbounded while every command held a small text or geometry delta, and
 * nothing about that was free — a command holds whatever it needs to reverse
 * itself, and a mask patch is already a region of a page in bytes. Merging
 * layers puts the pixels of all of them into one entry, which is what turns an
 * unbounded stack from untidy into a leak that only closing the project clears.
 *
 * A count and not a byte budget: a command is a pair of closures, and there is
 * nothing here to measure. What this bounds is how many of them are kept, which
 * is enough to stop the stack being the thing that grows for ever.
 */
export const UNDO_LIMIT = 100

/**
 * Sticky, as in Photoshop: the text tool stays until V takes it back. The
 * canvas's other gestures are held rather than toggled, which is why the
 * bottom bar has to say which tool is up — a cursor shape is gone the moment
 * the pointer leaves the canvas.
 *
 * The tool is also the mode. A drag on bare page can mean select a region,
 * sweep up text objects, or place a text box, and that collision is the only
 * thing that would otherwise force separate workspaces; picking a tool answers
 * it.
 *
 * `select` and `select-text` are two move tools side by side, both with the
 * same feel: click to take hold, drag to move. What is text's alone lives on
 * the second one — sweeping a marquee over objects, and drawing what they mean
 * over the page — because a general move tool that grew those would be
 * answering questions about text while somebody is nudging an erase patch.
 */
export type CanvasTool =
  | 'select'
  | 'select-text'
  | 'text'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'lasso-polygon'
  | 'wand'
  | 'brush'
  | 'eraser'

/** The tools whose drag builds a selection rather than acting on objects. */
export const SELECTION_TOOLS = [
  'marquee-rect',
  'marquee-ellipse',
  'lasso',
  'lasso-polygon',
  'wand',
  'brush',
  'eraser',
] as const satisfies readonly CanvasTool[]

export function isSelectionTool(tool: CanvasTool): boolean {
  return (SELECTION_TOOLS as readonly CanvasTool[]).includes(tool)
}

/**
 * The tools that draw the mask by hand, and which way round each one draws it.
 *
 * Taking mask away is the eraser's job rather than a modifier on the brush, so
 * a tool is up for one direction and stays there. Everything downstream asks
 * this rather than naming a tool, which is what keeps the two of them from
 * drifting apart as either grows settings of its own.
 */
const MASK_BRUSH_MODES = {
  brush: 'paint',
  eraser: 'erase',
} as const satisfies Partial<Record<CanvasTool, MaskBrushMode>>

export function maskBrushModeOf(tool: CanvasTool): MaskBrushMode | null {
  return tool in MASK_BRUSH_MODES ? MASK_BRUSH_MODES[tool as keyof typeof MASK_BRUSH_MODES] : null
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
  /**
   * What a sweep leaves selected, in one step. Adding them one at a time would
   * move the cursor — and with it the page the canvas turns to — once per
   * object caught, so a drag over a dozen would walk the view across all of
   * them before landing.
   */
  function selectMany(ids: readonly string[], additive: boolean) {
    const last = ids[ids.length - 1]
    if (last === undefined) {
      if (!additive) selectOnly(null)
      return
    }
    const next = additive ? new Set(selectedIds.value) : new Set<string>()
    for (const id of ids) next.add(id)
    selectedIds.value = next
    cursorId.value = last
    anchorId.value = last
  }

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

  /**
   * The colour the eyedropper puts away. Nothing reads it yet — it is here so
   * that sampling has somewhere to land rather than being invented alongside
   * the swatch that will show it.
   */
  const foreground = ref('#000000')

  /**
   * Whether the canvas says what its objects mean — tag colours and names on
   * top of the picture. Off by default: the page is the thing being judged, and
   * an editor that always draws its own bookkeeping over it answers a question
   * nobody asked while typesetting.
   */
  const showTags = ref(false)
  
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

  /**
   * The one choke point every way into typing goes through — a double click, a
   * key on a row, stepping to the next one — so a locked translation never gets
   * a caret in the first place. Letting the box open and refusing the keystrokes
   * would leave someone typing into something that quietly does nothing.
   */
  function beginTextEdit(filename: string, labelId: string, from: string) {
    commitTextEdit()
    if (isLayerLocked(labelId)) return
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
    const next = [...undoStack.value, cmd]
    // The oldest goes, as in any editor: what falls off the bottom is the work
    // furthest from where you are. Redo needs no bound of its own, since it can
    // only ever hold what this stack handed it.
    undoStack.value = next.length > UNDO_LIMIT ? next.slice(next.length - UNDO_LIMIT) : next
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
   * A new label is empty and carries no tags at all, so a run of them can be
   * placed first and both typed and classified later.
   *
   * Deliberately not inheriting whatever was last selected: a tag put on by the
   * tool rather than by the user is a tag nobody checked, and the batch
   * operations exist precisely so that tagging afterwards is cheap.
   */
  function addLabelAt(x: number, y: number) {
    const project = useProjectStore()
    if (!currentFilename.value) return
    cmdAddLabel(currentFilename.value, {
      kind: 'text',
      id: generateLabelId(),
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x,
      y,
      tags: [],
      rotation: 0,
      lines: [''],
      style: { ...project.header.seedStyle },
      provenance: {},
    })
  }

  /**
   * Where the panel's add button drops a label. The view centre is a container
   * coordinate, which is what `screenToPagePx` wants once the container's own
   * offset is taken out — and it can be off the page after a pan, hence the
   * clamp inside it.
   */
  function addLabelAtViewCenter() {
    const natural = viewContentSize.value
    if (!natural.w || !natural.h) return
    const p = screenToPagePx(
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
    // Where an object is read, and on which page it lives, are both things a
    // lock is put on to hold still.
    const moving = inChapterOrder(ids).filter((id) => !isLayerLocked(id))
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

    // Escaped rather than written out: a literal NUL in the source makes the
    // whole file binary to ripgrep, which then skips it without saying so.
    const settled =
      incoming.length === 0 &&
      [...orders].every(([p, order]) => order.join('\u0000') === before.get(p)?.join('\u0000'))
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
   *
   * A locked member is stepped over rather than taking the whole batch down
   * with it. Selecting ten and losing all ten to one lock would make the lock
   * the thing standing in the way; what stays behind is on screen and says so
   * for itself.
   */
  function deleteSelection() {
    const project = useProjectStore()
    const ids = unlockedSelection()
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
    if (isLayerLocked(labelId)) return
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


  /**
   * A raster layer's new placement, which arrives whole rather than written
   * through: the gesture previewed itself and left the entry alone, so this is
   * the first and only write.
   *
   * A turn or a scale hands over a new file as well as a new frame, and undo
   * puts the old name back — the old file is still on disk until orphans are
   * swept, which is what makes going back cost nothing.
   */
  function cmdPlaceLayer(
    filename: string,
    layerId: string,
    from: LayerPlace,
    to: LayerPlace,
  ) {
    if (isLayerLocked(layerId)) return
    const project = useProjectStore()
    pushCommand({
      label: `place-layer ${layerId}`,
      do: () => project.placeLayer(filename, layerId, to),
      undo: () => project.placeLayer(filename, layerId, from),
    })
  }

  /**
   * The angle and the position travel together, because a turn around anything
   * but the object's own middle swings it across the page as well as spinning
   * it — putting the angle back alone would leave it lying right and standing
   * somewhere else.
   */
  function cmdRotateLabel(
    filename: string,
    labelId: string,
    from: TurnedLabel,
    to: TurnedLabel,
  ) {
    if (JSON.stringify(from) === JSON.stringify(to) || isLayerLocked(labelId)) return
    const project = useProjectStore()
    const apply = (state: TurnedLabel) => {
      project.rotateLabel(filename, labelId, state.rotation)
      project.moveLabel(filename, labelId, state.x, state.y)
    }
    pushCommand(
      {
        label: `rotate-label ${labelId}`,
        do: () => apply(to),
        undo: () => apply(from),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * Both sides are snapshots of one label taken moments apart, so a string
   * compare is enough to tell a drag that ended where it started from one that
   * moved — which is what keeps a corner nudged and put back out of the undo
   * stack.
   *
   * The size and the position travel together because a corner drag changes
   * both and is one thing to undo: the size is what the pointer asked for and
   * the position is what holds the pinned corner still, so putting one back
   * without the other would leave the label somewhere nobody dragged it.
   */
  function cmdScaleLabel(
    filename: string,
    labelId: string,
    from: ScaledLabel,
    to: ScaledLabel,
  ) {
    if (JSON.stringify(from) === JSON.stringify(to)) return
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const apply = (state: ScaledLabel) => {
      project.setLabelStyle(filename, labelId, state.style, state.provenance)
      project.moveLabel(filename, labelId, state.x, state.y)
    }
    pushCommand(
      {
        label: `scale-label ${labelId}`,
        do: () => apply(to),
        undo: () => apply(from),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * A blank layer arrives with no frame at all. The first write places one and
   * later writes that reach past it grow it — an AI erase patch extended by
   * hand has to grow the same way, so nothing here is owed to this button alone.
   */
  function cmdAddRasterLayer(filename: string, layer: RasterLayerEntry, path?: number[]) {
    const project = useProjectStore()
    let removed: RemovedEntry | null = null
    pushCommand({
      label: `add-layer ${layer.id}`,
      do: () => {
        if (removed === null) project.addLayer(filename, layer, path)
        else project.restoreEntry(removed)
      },
      undo: () => {
        removed = project.removeEntry(layer.id)
      },
    })
    selectOnly(layer.id)
  }

  function cmdAddFolder(filename: string, name: string) {
    const project = useProjectStore()
    const folder: GroupLayerEntry = {
      kind: 'group',
      id: generateLabelId(),
      name,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: PASS_THROUGH,
      children: [],
    }
    let path: number[] | undefined
    pushCommand({
      label: `add-folder ${folder.id}`,
      do: () => project.addLayer(filename, folder, path),
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
    if (isLayerLocked(folderId)) return
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
    if (isLayerLocked(layerId)) return
    const project = useProjectStore()
    // What a folder holds is part of the folder, so a drop into a locked one is
    // a change to it — and moving out of a locked folder is already refused
    // above, since the entry inherits that lock.
    const file = project.fileByName(filename)
    const into = file ? folderAtPath(file.page.layers, target.parentPath) : null
    if (into !== null && isLayerLocked(into.id)) return
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

  /**
   * Whether an entry refuses to be changed, its ancestors included.
   *
   * Every command that would change a node asks this, and the surfaces ask it
   * too so a locked object simply does not offer the gesture. The commands are
   * the ones that matter: a guard on the surface is a courtesy, a guard here is
   * the protection the lock was put on for.
   *
   * Undo and redo deliberately go around it. They reach `projectStore` straight,
   * and locking is itself a command, so taking one back has already unlocked
   * whatever it needs by the time it runs.
   */
  function isLayerLocked(id: string): boolean {
    const project = useProjectStore()
    const page = project.pageOfEntry(id)
    if (page === null) return false
    const file = project.fileByName(page)
    return file ? isLocked(file.page.layers, id) : false
  }

  /** Whatever is selected that a change is still allowed to reach. */
  function unlockedSelection(): string[] {
    return [...selectedIds.value].filter((id) => !isLayerLocked(id))
  }

  /**
   * What the blending controls act on: everything selected that is on the open
   * page, in tree order.
   *
   * The selection reaches across pages, and these controls show one page's
   * tree — so anything selected elsewhere is deliberately left alone rather
   * than changed by a slider nobody could see it under.
   */
  function layersToBlend(): LayerEntry[] {
    const page = currentFilename.value
    if (page === null) return []
    const file = useProjectStore().fileByName(page)
    if (!file) return []
    return allEntries(file.page.layers).filter(
      (e) => selectedIds.value.has(e.id) && !isLocked(file.page.layers, e.id),
    )
  }

  /**
   * Everything selected, in one step of history — as with deleting, dimming
   * five layers is one act and five entries to undo would say it was five.
   *
   * `before` is read at the start of the drag rather than reconstructed, and
   * the whole thing is recorded on release: the slider writes straight through
   * so the page keeps up with the hand, which would otherwise leave a frame's
   * worth of entries to undo one at a time.
   */
  function cmdSetLayerOpacity(
    filename: string,
    before: ReadonlyMap<string, number>,
    opacity: number,
  ) {
    const moved = [...before].filter(([id, was]) => was !== opacity && !isLayerLocked(id))
    if (moved.length === 0) return
    const project = useProjectStore()
    pushCommand(
      {
        label: `set-opacity ${moved.length}`,
        do: () => {
          for (const [id] of moved) project.setLayerOpacity(filename, id, opacity)
        },
        undo: () => {
          for (const [id, was] of moved) project.setLayerOpacity(filename, id, was)
        },
      },
      { alreadyApplied: true },
    )
  }

  /**
   * A blend mode lands in one go rather than through a drag, so this applies it
   * as it goes and records only what the tree actually took: a selection can
   * hold both folders and layers, and pass-through is refused on everything but
   * a folder.
   */
  function cmdSetLayerBlendMode(
    filename: string,
    before: ReadonlyMap<string, string>,
    blendMode: string,
  ) {
    const project = useProjectStore()
    const moved: Array<[string, string]> = []
    for (const [id, was] of before) {
      if (was === blendMode || isLayerLocked(id)) continue
      if (!project.setLayerBlendMode(filename, id, blendMode)) continue
      moved.push([id, was])
    }
    if (moved.length === 0) return
    pushCommand(
      {
        label: `set-blend-mode ${moved.length}`,
        do: () => {
          for (const [id] of moved) project.setLayerBlendMode(filename, id, blendMode)
        },
        undo: () => {
          for (const [id, was] of moved) project.setLayerBlendMode(filename, id, was)
        },
      },
      { alreadyApplied: true },
    )
  }

  /**
   * `renameGroup` below is the text style groups, which are a different thing
   * entirely — the two have lived under confusingly close names since the tree
   * arrived, and this is the one that acts on the tree.
   */
  function cmdRenameLayer(filename: string, layerId: string, from: string, to: string) {
    if (from === to || isLayerLocked(layerId)) return
    const project = useProjectStore()
    // Applied first, as a restack is: a name the tree refuses — a text object
    // has none to change — must not reach the stack as an entry that undoes to
    // nothing.
    if (!project.renameLayer(filename, layerId, to)) return
    pushCommand(
      {
        label: `rename-layer ${layerId}`,
        do: () => project.renameLayer(filename, layerId, to),
        undo: () => project.renameLayer(filename, layerId, from),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * The one change a lock does not refuse — refusing it would leave no way to
   * take the lock off again.
   */
  function cmdSetLayerLocked(filename: string, layerId: string, locked: boolean) {
    const project = useProjectStore()
    pushCommand({
      label: `set-locked ${layerId}`,
      do: () => project.setLayerLocked(filename, layerId, locked),
      undo: () => project.setLayerLocked(filename, layerId, !locked),
    })
  }

  /**
   * Left out of the lock deliberately: the eye is a control for looking rather
   * than for changing, and a locked layer that could not be turned off for a
   * moment to see what is under it would be frozen rather than protected. The
   * same exception Photoshop, Krita and Clip Studio all make.
   */
  function cmdSetLayerVisible(filename: string, layerId: string, visible: boolean) {
    const project = useProjectStore()
    pushCommand({
      label: `set-visible ${layerId}`,
      do: () => project.setLayerVisible(filename, layerId, visible),
      undo: () => project.setLayerVisible(filename, layerId, !visible),
    })
  }

  /**
   * A lock that still lets the words be retyped is not protecting the thing it
   * was put on, so this refuses like every other change rather than being the
   * one exception content slips through.
   */
  function cmdUpdateLabelText(filename: string, labelId: string, oldText: string, newText: string) {
    if (oldText === newText || isLayerLocked(labelId)) return
    const project = useProjectStore()
    pushCommand({
      label: `update-text ${labelId}`,
      do: () => project.updateLabelText(filename, labelId, newText),
      undo: () => project.updateLabelText(filename, labelId, oldText),
    })
  }

  /** Every selected text object a change is allowed to reach, with its page. */
  function selectedTextObjects(): { filename: string; label: TextLayerEntry }[] {
    const project = useProjectStore()
    const out: { filename: string; label: TextLayerEntry }[] = []
    for (const id of unlockedSelection()) {
      const filename = project.pageOfEntry(id)
      if (filename === null) continue
      const label = project.labelById(filename, id)
      if (label) out.push({ filename, label })
    }
    return out
  }

  /**
   * How far a batch reaches, for the sentence shown before it runs. The
   * selection crosses pages and most of it may be somewhere nobody can see, so
   * an operation about to change forty objects on six pages has to say so.
   */
  const batchScope = computed(() => {
    const objects = selectedTextObjects()
    const pages = new Set(objects.map((o) => o.filename))
    return {
      objects: objects.length,
      pages: pages.size,
      offPage: [...pages].some((p) => p !== currentFilename.value),
    }
  })

  /**
   * One act, however many objects it touched. Undoing a batch has to put every
   * one of them back at once — anything else would leave the selection half
   * changed, which is a state the user never asked for and cannot see.
   */
  function cmdApplyStyleToSelection(patch: Partial<TextStyle>, source: string | null) {
    const project = useProjectStore()
    const targets = selectedTextObjects()
    if (targets.length === 0 || Object.keys(patch).length === 0) return
    const before = targets.map(({ filename, label }) => ({
      filename,
      id: label.id,
      state: { style: { ...label.style }, provenance: { ...label.provenance } },
    }))
    const after = before.map((entry) => ({
      ...entry,
      state: applyStylePatch(entry.state, patch, source),
    }))
    const write = (states: typeof before) => {
      for (const { filename, id, state } of states)
        project.setLabelStyle(filename, id, state.style, state.provenance)
    }
    pushCommand({
      label: `${source ?? 'style'} ${targets.length}`,
      do: () => write(after),
      undo: () => write(before),
    })
  }

  /**
   * Turning a tag on for a selection that already partly carries it means
   * putting it on the rest, not flipping each object separately: a control
   * showing one state has to end in one state, or a second click would undo
   * what the first appeared to do.
   */
  function cmdToggleTagOnSelection(tag: string) {
    const project = useProjectStore()
    const targets = selectedTextObjects()
    if (targets.length === 0) return
    const adding = !targets.every(({ label }) => label.tags.includes(tag))
    const before = targets.map(({ filename, label }) => ({
      filename,
      id: label.id,
      tags: [...label.tags],
    }))
    const after = before.map((entry) => ({
      ...entry,
      tags: adding ? withTag(entry.tags, tag) : withoutTag(entry.tags, tag),
    }))
    const write = (states: typeof before) => {
      for (const { filename, id, tags } of states) project.setLabelTags(filename, id, tags)
    }
    pushCommand({
      label: `${adding ? 'tag' : 'untag'} ${tag} ${targets.length}`,
      do: () => write(after),
      undo: () => write(before),
    })
  }

  function cmdSetLabelTags(filename: string, labelId: string, from: string[], to: string[]) {
    if (sameTagSet(from, to) || isLayerLocked(labelId)) return
    const project = useProjectStore()
    pushCommand({
      label: `set-tags ${labelId}`,
      do: () => project.setLabelTags(filename, labelId, to),
      undo: () => project.setLabelTags(filename, labelId, from),
    })
  }

  function cmdAddTag(name: string): boolean {
    const project = useProjectStore()
    const added = project.addTag(name)
    if (added === null) return false
    const index = project.header.tags.length - 1
    pushCommand(
      {
        label: `add-tag ${name}`,
        do: () => project.insertTagAt(index, added),
        undo: () => project.removeTagAt(index),
      },
      { alreadyApplied: true },
    )
    return true
  }

  /**
   * Dropping a registry entry takes away a colour and nothing else. Every
   * object keeps the tag, so this is not a delete anybody has to be warned
   * about — putting the entry back restores exactly what was lost.
   */
  function cmdRemoveTag(index: number) {
    const project = useProjectStore()
    const removed = project.removeTagAt(index)
    if (removed === null) return
    pushCommand(
      {
        label: `remove-tag ${removed.name}`,
        do: () => project.removeTagAt(index),
        undo: () => project.insertTagAt(index, removed),
      },
      { alreadyApplied: true },
    )
  }

  /** Reaches every object carrying the old name — see `projectStore.renameTag`. */
  function cmdRenameTag(from: string, to: string): boolean {
    const project = useProjectStore()
    if (!project.renameTag(from, to)) return false
    pushCommand(
      {
        label: `rename-tag ${from}`,
        do: () => project.renameTag(from, to),
        undo: () => project.renameTag(to, from),
      },
      { alreadyApplied: true },
    )
    return true
  }

  function cmdMoveTag(from: number, to: number) {
    if (from === to) return
    const project = useProjectStore()
    pushCommand({
      label: `move-tag ${from}`,
      do: () => project.moveTag(from, to),
      undo: () => project.moveTag(to, from),
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
    selectMany,
    extendSelectionTo,
    collapsedLayerIds,
    labelQuery,
    tool,
    setTool,
    foreground,
    showTags,
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
    cmdPlaceLayer,
    cmdRotateLabel,
    cmdScaleLabel,
    cmdAddRasterLayer,
    cmdAddFolder,
    cmdDissolveFolder,
    cmdMoveLayer,
    cmdSetLayerVisible,
    cmdSetLayerLocked,
    isLayerLocked,
    cmdRenameLayer,
    cmdSetLayerOpacity,
    cmdSetLayerBlendMode,
    layersToBlend,
    cmdUpdateLabelText,
    selectedTextObjects,
    batchScope,
    cmdApplyStyleToSelection,
    cmdToggleTagOnSelection,
    cmdSetLabelTags,
    cmdAddTag,
    cmdRemoveTag,
    cmdRenameTag,
    cmdMoveTag,
  }
})
