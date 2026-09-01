import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type {
  GroupLayerEntry,
  LayerEntry,
  RasterLayerEntry,
  SourceBody,
  TextLayerEntry,
  TranslationCandidate,
} from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import { useZoomPan, type Size } from '@/composables/useZoomPan'
import type { ProjectFile } from '@/types/project'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useCardStore } from '@/stores/cardStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore, type LabelPlace, type RemovedEntry } from '@/stores/projectStore'
import { clamp, screenToPagePx } from '@/lib/coords'
import { blankTextObject, emptyBody, generateId as generateLabelId } from '@shared/page/schema'
import { bodyOnSide, linesOf, textOnSide, type TextSide } from '@shared/page/text'
import { folderAtPath, isLocked, textObjects } from '@shared/page/tree'
import { hasEdge, type ReadingEdge } from '@shared/page/readingGraph'
import { flattenLayerRows } from '@/lib/layerRows'
import type { LayerPlace } from '@/lib/layerTransform'
import { buildLabelRows, chapterStops, type ChapterRow } from '@/lib/labelRows'
import { bucketObjectsOf, type BucketObject } from '@/lib/valueBuckets'
import type { AppearanceKind, AppearanceTarget } from '@/lib/appearance'
import { deriveStyle } from '@/lib/styleRecommendation'
import type { MaskBrushMode } from '@/lib/selection/brushMask'
import type { MaskTarget } from '@/lib/selection/mask'
import type { DropTarget } from '@shared/page/tree'
import type { TextStyle } from '@shared/text-style/types'
import type { LayerEffect } from '@shared/effects/types'
import { cloneEffects } from '@shared/effects/clone'
import { normalizeTagSet, sameTagSet, withTag, withoutTag } from '@shared/tags/set'
import type { Typography, Verdict } from '@shared/ocr/decide'
import { drawnLabel } from '@/lib/labelRaster'

/**
 * Which registry an external record a command depends on lives in.
 *
 * Raster and mask journals are each named by their own counter in the
 * engine (`j1, j2, ...` and `m1, m2, ...`), in two separate registries — nothing
 * stops the same string appearing in both. Tagging every dependency with the
 * registry it names, rather than trusting the two never collide, is what
 * keeps a raster cut from ever reaching into the mask stack or back.
 */
export type JournalKind = 'raster' | 'mask'

/** One external record a command needs in order to be undone. */
export interface JournalDependency {
  kind: JournalKind
  name: string
}

/** A raster journal dependency, for a command that swaps a layer's pixels. */
export function rasterJournal(name: string): JournalDependency {
  return { kind: 'raster', name }
}

/** A mask journal dependency, for a command that swaps a selection's bytes. */
export function maskJournal(name: string): JournalDependency {
  return { kind: 'mask', name }
}

/**
 * What a step answers about itself. `false`, and only `false`, means it was
 * refused and nothing changed; anything else — `true`, or nothing at all —
 * means it went through. Most commands can never be refused, and a plain
 * `void` return is what lets them stay exactly as simple as a command that
 * cannot fail has any reason to be.
 */
export type CommandResult = boolean | void

export interface Command {

  label: string
  /**
   * Applies the step. A `false` back means the write was refused — checked
   * before anything was touched, the same way every writer behind this
   * already checks its own precondition before it mutates — so refused and
   * unapplied are the same fact told once.
   */
  do(): CommandResult
  /** The same contract as `do`, backwards. */
  undo(): CommandResult
  /**
   * Every external record this command needs in order to be undone.
   *
   * A pixel step is two things kept in step: a record the engine holds and a
   * frame the manifest holds. These name the engine's half, so the stack can
   * be cut where the engine says that half is gone. A command can hold several
   * — a selection gesture that first put the old mask away and then wrote the
   * new one needs both back to undo either.
   */
  journals?: readonly JournalDependency[]
  /**
   * Which book this command belongs to — the project whose pages it changed.
   * Stamped by `pushCommand` from whichever project was open when the command
   * was pushed; a command never sets this itself. It is what routes an undo
   * or a redo to the right book's stack rather than to whatever project
   * happens to be loaded when the key is pressed.
   */
  book?: string
  /**
   * Whether this command needs nothing but its book's `project.json` to run,
   * so it stays reachable with that book closed — or whether it captured a
   * singleton store or an engine resource and only runs in the session that
   * made it.
   *
   * ⛔ Decided by what the command depends on, never by which store happened
   * to be writing when it was pushed. A page-order command needs only its
   * book's `project.json` and is portable wherever the user was standing;
   * reading it off the writer of the moment made the same gesture survive a
   * close or not according to an accident of where they were.
   *
   * Closing a book cuts its stack at the newest session-bound command, the
   * same linear barrier `forgetJournals` already applies to a lost journal —
   * what survives is whichever portable run sits above it.
   */
  portable?: boolean
  /**
   * Called once, when this command leaves the stack for good — not when it is
   * merely undone. Whatever it holds outside the store is let go here.
   */
  forget?(): void
}

/** Everything a corner drag leaves changed about one label. */
export interface ScaledLabel {
  style: TextStyle
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
 *
 * ⚠️ Per book, not per app. A stack now survives switching away from its book,
 * so this reads as "100 steps each" rather than "100 steps total" — the number
 * of books that keep a stack around at once is bounded separately, by
 * `MAX_TRACKED_BOOKS`.
 */
export const UNDO_LIMIT = 100

/**
 * How many books keep a stack around at once before the least-recently
 * touched one is dropped entirely, its commands' `forget` called the same as
 * any other eviction.
 *
 * Closing a book cuts every session-bound command from its stack, so a book
 * only ever edited in the editor leaves nothing behind. What this bounds is
 * the portable run: paging through the library and dragging pages around in
 * book after book, without ever opening one in the editor, must not
 * accumulate one live entry here per book it ever glanced at. Twenty is
 * generous against that — a session working steadily in one book keeps that
 * book at the most-recently-touched end for as long as it stays open, so the
 * bound only ever prunes books nothing has touched in a while.
 */
export const MAX_TRACKED_BOOKS = 20

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
 *
 * `connect` is where the tool being the mode pays for itself: pressing an
 * object already means take hold of it, so drawing a line from one would have
 * collided with moving it. Under this tool a press means draw, and moving an
 * object is what the move tool is for.
 */
export type CanvasTool =
  | 'select'
  | 'select-text'
  | 'connect'
  | 'text'
  | 'marquee-rect'
  | 'marquee-ellipse'
  | 'lasso'
  | 'lasso-polygon'
  | 'wand'
  | 'brush'
  | 'eraser'
  | 'tag-paint'

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


/**
 * What a measured leading is allowed to come back as.
 *
 * The head that answers it reads the gap between two lines, and a region
 * holding a single line has no gap to be read — what comes back there is
 * invented, and under 100% it stacks the lines through each other. Wide enough
 * that a leading actually read off two lines passes through untouched.
 */
const MIN_LEADING_PERCENT = 100
const MAX_LEADING_PERCENT = 250

/**
 * The type size of every source object on a page, as a share of its short edge.
 *
 * ⭐ The source side is not typeset — it is read against the artwork underneath
 * it, which is the one thing setting it the way the artwork is set would cover.
 * So it is held at one size for the whole page and the measurement is spent on
 * the translation, which is the side that has to end up looking like the
 * original. The short edge rather than either named one, so a spread and a
 * single page put the same size on screen.
 *
 * The number is what carries the default type size across resolutions: a
 * fiftieth of 1200px is `DEFAULT_TEXT_STYLE.fontSizePx`, so a page scanned at
 * four times that reads at four times the size and neither of them has to be
 * zoomed to be legible over the artwork.
 */
const SOURCE_SIZE_DIVISOR = 50

/**
 * A style set the way one run measured the artwork, over whatever it is being
 * laid on. A field the run did not measure keeps the value underneath — absent
 * means nothing was measured, and filling it in with a guess would let an
 * estimate be read as an observation.
 *
 * ⭐ The two measured numbers are rounded on the way in. What arrives is the
 * output of a square root or a regression head, carrying fifteen significant
 * digits of precision it does not have — and the statistics that ask "what size
 * does this kind of line use" bucket by exact equality, so every object landed
 * in a bucket of its own and the recommendations were a wall of ones. Rounding
 * costs nothing anybody can see at these sizes and gives the question back its
 * premise.
 */
function measuredStyle(base: TextStyle, measured: Typography): TextStyle {
  return {
    ...base,
    direction:
      measured.vertical === undefined
        ? base.direction
        : measured.vertical
          ? 'vertical'
          : 'horizontal',
    fontSizePx: measured.fontSizePx === undefined ? base.fontSizePx : Math.round(measured.fontSizePx),
    leadingPercent:
      measured.leadingPercent === undefined
        ? base.leadingPercent
        : clamp(Math.round(measured.leadingPercent), MIN_LEADING_PERCENT, MAX_LEADING_PERCENT),
  }
}

/**
 * The same run's measurement, at the one size the source side is read at.
 *
 * ⭐ The leading rides along exactly as measured. It is a share of the type
 * size rather than a length, so the spacing a balloon was set with survives
 * being re-set at a size that balloon never used — which is what keeps a
 * source object reading with the rhythm of the line it stands for.
 */
function sourceStyle(
  base: TextStyle,
  measured: Typography,
  page: { width: number; height: number },
): TextStyle {
  return {
    ...measuredStyle(base, measured),
    fontSizePx: Math.round(Math.min(page.width, page.height) / SOURCE_SIZE_DIVISOR),
  }
}

/**
 * The corner to write so that an empty object comes out centred on `at`, which
 * corner the anchor names being a matter of how the text is aligned.
 *
 * ⚠️ Worked out per side. The two sides are no longer set at one size, so one
 * anchor written to both would centre whichever side it was computed from and
 * hang the other off it.
 */
function anchorFor(style: TextStyle, at: { x: number; y: number }): { x: number; y: number } {
  const empty = drawnLabel('', style, [], { x: 0, y: 0 }, 0)
  return { x: at.x - empty.center.x, y: at.y - empty.center.y }
}


export const useEditorStore = defineStore('editor', () => {
  const currentPageId = ref<string | null>(null)

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
   * Turn to a page and leave the selection alone. Every way of getting to
   * another page goes through here — the arrows, the page bar, a heading in the
   * list, an undo landing somewhere you have since navigated away from.
   *
   * A selection reaches across pages on purpose, since that is what the batch
   * operations act on. Turning a page is a move of the eyes, and one that
   * dropped the selection would make looking at page 3 to check something cost
   * the set you spent a sweep building.
   */
  function showPage(pageId: string) {
    if (pageId === currentPageId.value) return
    commitTextEdit()
    currentPageId.value = pageId
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
   * What the tag brush is loaded with. Empty is a load like any other — it is
   * how the brush takes a meaning away, so there is no second tool for that.
   */
  const paintTags = ref<string[]>([])

  function loadPaintTags(tags: readonly string[]) {
    paintTags.value = normalizeTagSet(tags)
  }

  /**
   * Which of an object's two bodies everything is working on.
   *
   * ⭐ A mode and not a tool. Which half of an object is being worked on is
   * orthogonal to what the pointer does, so placing, moving, connecting and
   * selecting all go on working while it is up; a tool slot would have made
   * "work on the source" and "move things" mutually exclusive, which is two
   * unrelated questions sharing one answer.
   */
  const textSide = ref<TextSide>('translation')

  function setTextSide(side: TextSide) {
    // The session below remembers the side it opened on, but a caret left in a
    // box while the mode flips would go on writing into a body nothing on
    // screen is showing any more.
    commitTextEdit()
    textSide.value = side
  }

  /**
   * The colour the eyedropper puts away. Nothing reads it yet — it is here so
   * that sampling has somewhere to land rather than being invented alongside
   * the swatch that will show it.
   */
  const foreground = ref('#000000')

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
   * with the page's own grid, which is what a mask is measured in.
   *
   * The size is the manifest's, so nothing has to decode for it to be known.
   * Null only while no page is open, or before the view has said what it is
   * looking at.
   */
  const maskTarget = computed<MaskTarget | null>(() => {
    const page = currentPageId.value
    const size = viewContentSize.value
    if (page === null || size.w === 0 || size.h === 0) return null
    return { page, w: size.w, h: size.h }
  })

  /**
   * A project's `rootPath`, or `null` before anything has ever been opened —
   * the key a book's undo history is filed under.
   *
   * Read from `projectStore` rather than tracked by hand: the singleton it
   * names is exactly what a session-bound command's closure reaches for, so
   * the book a freshly pushed command belongs to is whichever one that store
   * currently holds. Anything held separately here could drift out of step
   * with it; this cannot.
   */
  type BookId = string | null
  const currentBook = computed<BookId>(() => useProjectStore().rootPath)

  interface BookHistory {
    undo: Command[]
    redo: Command[]
  }
  const EMPTY_HISTORY: BookHistory = { undo: [], redo: [] }

  /**
   * Every book that currently holds a stack, oldest-touched first — a plain
   * `Map` keeps insertion order for free, and `setHistory` re-inserting a key
   * on every touch is what keeps that order meaning "least recently touched
   * first" rather than "first ever touched first".
   *
   * Reassigned rather than mutated in place, like the single stack this
   * replaced: a `shallowRef` only notices the top-level value changing.
   */
  const histories = shallowRef<Map<BookId, BookHistory>>(new Map())

  function historyOf(book: BookId): BookHistory {
    return histories.value.get(book) ?? EMPTY_HISTORY
  }

  /**
   * Writes a book's history back, bumping it to the most-recently-touched end
   * of the map and evicting the least-recently-touched book once the count
   * passes `MAX_TRACKED_BOOKS`. An empty history is dropped outright rather
   * than kept as an empty entry — indistinguishable from absence in
   * `historyOf`, and keeping it would waste a slot in the bound above on
   * every book that was ever merely closed.
   *
   * A book that loses its history here also loses the handle it was held by:
   * the two are bounded together, so paging through the library dragging
   * pages about cannot leave one live `project.json` in memory per book it
   * ever touched. `retire` is what keeps that from throwing away a write that
   * has not landed yet.
   */
  function setHistory(book: BookId, next: BookHistory) {
    const map = new Map(histories.value)
    const had = map.has(book)
    map.delete(book)
    if (next.undo.length > 0 || next.redo.length > 0) map.set(book, next)
    else if (had && book !== null) void useBookMetaStore().retire(book)
    while (map.size > MAX_TRACKED_BOOKS) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      const gone = map.get(oldest)
      if (gone) for (const cmd of [...gone.undo, ...gone.redo]) cmd.forget?.()
      map.delete(oldest)
      if (oldest !== null) void useBookMetaStore().retire(oldest)
    }
    histories.value = map
  }

  const canUndo = computed(() => historyOf(currentBook.value).undo.length > 0)
  const canRedo = computed(() => historyOf(currentBook.value).redo.length > 0)

  /**
   * How many strokes are between their press and the commit that either
   * lands or throws. Counted rather than a single flag: a stroke's commit
   * outlives its release, and a fast second press can open before the first
   * one's has run — `useLayerBrush`'s own release queue is built around that
   * same overlap.
   *
   * Undo and redo refuse outright while this is above zero. Measured on
   * Photoshop by hand: Ctrl+Z mid-stroke does nothing at all, neither
   * touching the stroke before it nor cancelling the one under way.
   */
  const strokesInFlight = ref(0)
  const strokeInFlight = computed(() => strokesInFlight.value > 0)

  function beginStroke() {
    strokesInFlight.value += 1
  }

  function finishStroke() {
    strokesInFlight.value = Math.max(0, strokesInFlight.value - 1)
  }

  /**
   * Where a freshly opened project starts: on this page, on its first object.
   *
   * Deliberately not named for turning a page, and deliberately not what
   * anything else calls. Every other way to another page keeps the selection —
   * this one is the case where there is nothing yet to keep.
   */
  function startOnPage(pageId: string | null) {
    commitTextEdit()
    currentPageId.value = pageId
    const project = useProjectStore()
    selectOnly(pageId ? (project.labelsOf(pageId)[0]?.id ?? null) : null)
  }

  
  /**
   * Turn the page and leave the selection where it is.
   *
   * Paging is a move of the eyes, not of the hand. A selection reaches across
   * pages on purpose — it is what the batch operations act on — so a turn that
   * dropped it would make looking at the next page to check something cost the
   * set you had spent a sweep building, with nothing having said so.
   */
  function pageBy(offset: number) {
    const project = useProjectStore()
    if (project.files.length === 0) return
    const index = project.files.findIndex((f) => f.pageId === currentPageId.value)
    const next = index === -1 ? 0 : index + offset
    if (next < 0 || next >= project.files.length) return
    showPage(project.files[next].pageId)
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
        : cursorId.value === null && r.pageId === currentPageId.value,
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
    currentPageId.value = row.pageId
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
    if (!currentPageId.value) return
    const file = project.pageById(currentPageId.value)
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
   * make reading down it unbearable.
   */
  function revealLabel(pageId: string, labelId: string) {
    showPage(pageId)
    selectOnly(labelId)
  }

  /**
   * The translation being typed right now. Every keystroke writes straight
   * through so the page keeps up, and the editing session is what enters the
   * undo stack — the same split the drag gestures use. One entry per label you
   * visited reads as "you edited this line", where a time window would let
   * typing speed decide how much an undo takes back.
   */
  const pendingTextEdit = ref<{
    pageId: string
    labelId: string
    from: string
    /**
     * ⭐ The session's own, read back from here rather than from the mode.
     * Toggling which side is shown mid-sentence must not send the rest of what
     * is typed into the other half of the object.
     */
    side: TextSide
    /**
     * Whether the proposal being typed into was already somebody's when the
     * caret opened.
     *
     * ⚠️ Taken here and nowhere later. Typing writes through and stamps as it
     * goes, so by the time the session is committed the answer has already been
     * overwritten by the very edit being recorded.
     */
    wasTheirs: boolean
  } | null>(null)

  /** Undefined once the label being edited has been deleted under the caret. */
  function textOfPending(): string | undefined {
    const pending = pendingTextEdit.value
    if (!pending) return undefined
    const project = useProjectStore()
    const label = project.labelById(pending.pageId, pending.labelId)
    return label === undefined ? undefined : textOnSide(label, pending.side)
  }

  /**
   * The reading being corrected right now, on the same split as a translation:
   * every keystroke writes straight through, so the card and the markings on it
   * keep up, and the visit is what enters the undo stack.
   *
   * ⚠️ A reference of its own rather than a second shape for `pendingTextEdit`,
   * which several places read expecting an object's. Only one of the two is ever
   * open — there is one caret — and `commitTextEdit` closes this kind first, so
   * every place that already ends a typing session ends this one too.
   */
  const pendingReadingEdit = ref<{ pageId: string; hash: string; from: string } | null>(null)

  /** Undefined once the reading being corrected has left the pool under the caret. */
  function textOfPendingReading(): string | undefined {
    const pending = pendingReadingEdit.value
    if (!pending) return undefined
    const project = useProjectStore()
    return project.readingsOfPage(pending.pageId).find((r) => r.hash === pending.hash)?.text
  }

  function beginReadingEdit(pageId: string, hash: string, from: string) {
    commitTextEdit()
    pendingReadingEdit.value = { pageId, hash, from }
  }

  function commitReadingEdit() {
    const pending = pendingReadingEdit.value
    if (!pending) return
    const text = textOfPendingReading()
    // Cleared first, as on the object side: the command below re-enters here
    // through pushCommand, and this is what stops it recursing.
    pendingReadingEdit.value = null
    if (text === undefined) return
    cmdUpdateReadingText(pending.pageId, pending.hash, pending.from, text)
  }

  /**
   * The one choke point every way into typing goes through — a double click, a
   * key on a row, stepping to the next one — so a locked translation never gets
   * a caret in the first place. Letting the box open and refusing the keystrokes
   * would leave someone typing into something that quietly does nothing.
   */
  function beginTextEdit(pageId: string, labelId: string, from: string) {
    commitTextEdit()
    if (isLayerLocked(labelId)) return
    const side = textSide.value
    const wasTheirs = chosenCandidate(pageId, labelId, side)?.human === true
    pendingTextEdit.value = { pageId, labelId, from, side, wasTheirs }
  }

  function commitTextEdit() {
    // Both kinds of visit end here, so the eleven places that already close a
    // typing session — changing page, changing selection, every command — close
    // a correction to a reading without any of them having to know it exists.
    commitReadingEdit()
    const pending = pendingTextEdit.value
    if (!pending) return
    const text = textOfPending()
    // Cleared first: the command below re-enters here through pushCommand, and
    // this is what stops it recursing.
    pendingTextEdit.value = null
    // The label was deleted mid-edit, and the delete already captured its text.
    if (text === undefined) return
    cmdUpdateLabelText(
      pending.pageId,
      pending.labelId,
      pending.side,
      pending.from,
      text,
      pending.wasTheirs,
    )
  }

  /**
   * Finish this row and open the next one for typing — the loop a chapter is
   * actually translated in, and the reason it is worth a key of its own.
   *
   * Commits before moving: staying on the same page does not go through
   * `showPage`, so nothing else would close the visit, and the session would
   * follow the cursor onto a row it was never opened on.
   */
  function editBy(offset: number) {
    commitTextEdit()
    selectLabelBy(offset)
    const page = currentPageId.value
    const id = cursorId.value
    if (page === null || id === null) return
    const label = useProjectStore().labelById(page, id)
    if (!label) return
    beginTextEdit(page, id, textOnSide(label, textSide.value))
  }

  /**
   * Bank what has been typed without ending the visit, for a save that lands
   * mid-sentence: the undo stack has to agree with what went to disk, and the
   * caret is still in the box.
   */
  function flushTextEdit() {
    const pending = pendingTextEdit.value
    const text = textOfPending()
    const reading = pendingReadingEdit.value
    const readingText = textOfPendingReading()
    commitTextEdit()
    if (reading && readingText !== undefined) {
      pendingReadingEdit.value = { ...reading, from: readingText }
    }
    if (!pending || text === undefined) return
    pendingTextEdit.value = { ...pending, from: text }
  }

  /**
   * Every command lands here, so this is where an open text edit is closed:
   * the stack has to run in the order things happened, or undoing a delete
   * after the text change it swallowed replays them the wrong way round.
   *
   * Answers whether the command joined the stack. A command that is not
   * `alreadyApplied` runs its own `do()` right here, and a `false` back from
   * that means the write was refused — nothing is pushed, since there is
   * nothing yet to undo.
   */
  function pushCommand(cmd: Command, opts?: { alreadyApplied?: boolean; book?: BookId }): boolean {
    commitTextEdit()
    if (!opts?.alreadyApplied && cmd.do() === false) {
      useNoticeStore().say('這個操作沒有套用')
      return false
    }
    const book = opts?.book ?? currentBook.value
    cmd.book = book ?? undefined
    cmd.portable = cmd.portable ?? false
    const history = historyOf(book)
    const next = [...history.undo, cmd]
    // The oldest goes, as in any editor: what falls off the bottom is the work
    // furthest from where you are. Redo needs no bound of its own, since it can
    // only ever hold what this stack handed it.
    const over = next.length - UNDO_LIMIT
    let kept = next
    if (over > 0) {
      for (const gone of next.slice(0, over)) gone.forget?.()
      kept = next.slice(over)
    }
    for (const gone of history.redo) gone.forget?.()
    setHistory(book, { undo: kept, redo: [] })
    return true
  }

  /** Whether a command names one of the given journals, in the given registry. */
  function dependsOnJournal(cmd: Command, kind: JournalKind, gone: ReadonlySet<string>): boolean {
    return cmd.journals?.some((dep) => dep.kind === kind && gone.has(dep.name)) ?? false
  }

  /**
   * Cuts the stack where the engine says a step's record is gone — a raster
   * journal by default, since every caller before this one only ever lost
   * those; a mask journal when a caller names `'mask'`.
   *
   * Everything at or below the newest of these goes, not just the named steps:
   * history is linear, and a step you cannot replay is one nothing under it can
   * be reached past. Redo goes entirely, since a branch that outlived its own
   * record can no longer be replayed either.
   *
   * The bound itself lives wherever the record does — the engine's raster
   * registry for a raster journal, this store's own tally of live mask
   * journals for a mask one. This is the stack following either.
   *
   * `book` defaults to whichever project is open now, which is right for
   * every caller before this ticket: a raster release or a quota trim can
   * only ever happen to the book currently loaded. The one caller that names
   * a book explicitly is a project switch stranding the outgoing book's mask
   * journals — by the time it runs, `currentBook` already names the book
   * being switched to, not the one that lost them.
   */
  function forgetJournals(
    names: readonly string[],
    kind: JournalKind = 'raster',
    book: BookId = currentBook.value,
  ) {
    if (names.length === 0) return
    const gone = new Set(names)
    const history = historyOf(book)
    let cut = -1
    history.undo.forEach((cmd, at) => {
      if (dependsOnJournal(cmd, kind, gone)) cut = at
    })
    let nextUndo = history.undo
    if (cut >= 0) {
      for (const dropped of history.undo.slice(0, cut + 1)) dropped.forget?.()
      nextUndo = history.undo.slice(cut + 1)
    }
    let nextRedo = history.redo
    if (history.redo.some((cmd) => dependsOnJournal(cmd, kind, gone))) {
      for (const dropped of history.redo) dropped.forget?.()
      nextRedo = []
    }
    if (nextUndo !== history.undo || nextRedo !== history.redo) {
      setHistory(book, { undo: nextUndo, redo: nextRedo })
    }
  }

  /**
   * Closed before the stack is read, not after: a session still open is the
   * most recent thing that happened, so it is what an undo has to take back.
   * Reading the stack first would reach past it to some earlier command and
   * leave the typing standing.
   */
  /**
   * `book` defaults to whichever project is open, which is right for every
   * caller before this ticket — the editor only ever undoes its own book.
   * The library passes the book it is standing in instead, since a shelf
   * gesture can target a book that is not open, or open while a different
   * one is.
   *
   * The stack does not move until the step is known to have gone back.
   * Taking `cmd` off the top first and putting it back on a refusal would
   * assume that restoring its place on the stack is the same thing as
   * restoring the data — it is not, and a step that verifies its own
   * precondition before it writes (every one here does) never leaves
   * anything to put back in the first place.
   */
  /**
   * A step that went back leaves a write behind it, and nothing was waiting on
   * that write: a `mark` reports through `onError`, which is the console. So
   * an undo whose bytes never reached the disk looked exactly like one whose
   * did, and the next open would show the order it had taken back.
   *
   * ⛔ Only for a step that carries its book's `project.json` and nothing else.
   * `projectStore.flush` settles pixels first — a whole layer encoded per
   * keystroke, which is the cost `PIXEL_DEBOUNCE_MS` exists to spread out.
   */
  function settleBook(cmd: Command, book: BookId): void {
    if (cmd.portable !== true || book === null) return
    const project = useProjectStore()
    const landed = project.isOpenRoot(book)
      ? project.flushManifest()
      : useBookMetaStore().flush(book)
    void landed.catch((err) => {
      console.error('undo write failed', err)
      useNoticeStore().say('這一步撤銷了，但沒有存進磁碟')
    })
  }

  function undo(book: BookId = currentBook.value) {
    if (strokeInFlight.value) return
    commitTextEdit()
    const history = historyOf(book)
    const cmd = history.undo.at(-1)
    if (!cmd) return
    if (cmd.undo() === false) {
      useNoticeStore().say('撤銷失敗，這一步沒有生效')
      return
    }
    const after = historyOf(book)
    setHistory(book, {
      undo: after.undo.filter((c) => c !== cmd),
      redo: [...after.redo, cmd],
    })
    settleBook(cmd, book)
  }

  /**
   * Typing after an undo ends the redo branch, as it does in any editor.
   *
   * The same order as `undo`: `cmd.do()` runs before the stack moves, and a
   * `false` back leaves the redo branch exactly as it was rather than
   * discarding the step that refused to replay.
   */
  function redo(book: BookId = currentBook.value) {
    if (strokeInFlight.value) return
    commitTextEdit()
    const history = historyOf(book)
    const cmd = history.redo.at(-1)
    if (!cmd) return
    if (cmd.do() === false) {
      useNoticeStore().say('重做失敗，這一步沒有生效')
      return
    }
    const after = historyOf(book)
    setHistory(book, {
      undo: [...after.undo, cmd],
      redo: after.redo.filter((c) => c !== cmd),
    })
    settleBook(cmd, book)
  }

  /** Wipes the current book's stack — nothing else's. */
  function clearHistory() {
    const book = currentBook.value
    const history = historyOf(book)
    for (const gone of [...history.undo, ...history.redo]) gone.forget?.()
    setHistory(book, { undo: [], redo: [] })
    pendingTextEdit.value = null
  }

  /**
   * Closes a book: cuts its stack at the newest session-bound command, the
   * same linear rule `forgetJournals` applies to a lost journal. A command
   * that reaches for the singleton `useProjectStore()` cannot be trusted once
   * that store no longer holds this book, so it and everything under it goes;
   * what survives is whichever portable run sits above it, kept exactly as it
   * was for the next time this book is opened.
   *
   * Redo is cut the same way `forgetJournals` cuts it: any branch that still
   * needs a session-bound step to replay is dropped whole, not trimmed.
   *
   * A no-op for a book with no entry — every book the app has never touched,
   * and every book already closed with nothing portable left to keep.
   */
  function closeBook(book: BookId) {
    const history = histories.value.get(book)
    if (!history) return
    let cut = -1
    history.undo.forEach((cmd, at) => {
      if (!cmd.portable) cut = at
    })
    let nextUndo = history.undo
    if (cut >= 0) {
      for (const dropped of history.undo.slice(0, cut + 1)) dropped.forget?.()
      nextUndo = history.undo.slice(cut + 1)
    }
    let nextRedo = history.redo
    if (history.redo.some((cmd) => !cmd.portable)) {
      for (const dropped of history.redo) dropped.forget?.()
      nextRedo = []
    }
    setHistory(book, { undo: nextUndo, redo: nextRedo })
  }

  /**
   * Where a write to `book` goes, asked afresh on every `do`/`undo`/`redo`.
   *
   * ⭐ Which authority owns a book changes underneath a command that is
   * already on the stack — opening it hands the book to `projectStore`,
   * leaving it hands the book back — and the command outlives every one of
   * those handovers. Deciding once, when the shelf let go, is what made a
   * reorder followed by an open silently do nothing: the writer it had closed
   * over was the very thing the open took away.
   *
   * The book's path is what the command holds instead, and the routing here
   * is what turns that path into whoever is writing the file right now.
   */
  function bookWriter(book: string) {
    const project = useProjectStore()
    const bookMeta = useBookMetaStore()
    const openHere = () => project.isOpenRoot(book)
    return {
      applyOrderSnapshot: (snapshot: readonly string[]) =>
        openHere()
          ? project.applyOrderSnapshot(snapshot)
          : bookMeta.applyOrderSnapshot(book, snapshot),
      placePages: (entries: readonly ProjectFile[], order: readonly string[]) =>
        openHere() ? project.insertPages(entries, order) : bookMeta.placePages(book, order),
      tagDeleted: (ids: readonly string[]) =>
        openHere() ? project.tagPagesDeleted(ids) : bookMeta.tagDeleted(book, ids),
      untagDeleted: (ids: readonly string[]) =>
        openHere() ? project.untagPagesDeleted(ids) : bookMeta.untagDeleted(book, ids),
    }
  }

  /**
   * A drag that reordered pages, `before` and `after` each a complete order —
   * tombstoned pages included, so neither end has to depend on the selection
   * or the drop point still meaning anything by the time it runs again.
   *
   * The first portable command, and portable whether or not that book happens
   * to be open: what makes a command portable is what it depends on, and this
   * one depends on nothing but `book`'s own `project.json`. Reading it off
   * whichever store was writing at the time would have made the same gesture
   * survive a close or not according to where the user happened to be
   * standing when they made it.
   */
  function cmdSetPageOrder(book: BookId, before: readonly string[], after: readonly string[]) {
    if (book === null || before.join('\u0000') === after.join('\u0000')) return
    const writer = bookWriter(book)
    pushCommand(
      {
        label: `reorder-pages ${book}`,
        portable: true,
        do: () => writer.applyOrderSnapshot(after),
        undo: () => writer.applyOrderSnapshot(before),
      },
      { book },
    )
  }

  /**
   * Files dropped onto the page band: each is already a page on disk by the
   * time this runs — `createPage` is irreversible and happens once, before
   * the shelf pushes this — so undo only ever tombstones them. The name is
   * never taken out of `pages`, which is what lets the position it landed at
   * survive being undone and redone.
   *
   * ⛔ The two halves of `do` are not the same operation, and only the first
   * run does both. Placing widens the page list; a redo must not, because
   * `after` describes the chapter as it stood at the drop and the chapter may
   * have gained tombstoned pages since — re-applying it would speak for slots
   * it never saw. Everything a redo has to undo is the tombstone.
   */
  function cmdImportPages(
    book: BookId,
    ids: readonly string[],
    entries: readonly ProjectFile[],
    after: readonly string[],
  ) {
    if (book === null || ids.length === 0) return
    const writer = bookWriter(book)
    let placed = false
    pushCommand(
      {
        label: `import-pages ${book} ${ids.length}`,
        portable: true,
        do: () => {
          if (placed) return writer.untagDeleted(ids)
          if (!writer.placePages(entries, after)) return false
          placed = true
          return true
        },
        undo: () => writer.tagDeleted(ids) !== false,
      },
      { book },
    )
  }

  function cmdAddLabel(pageId: string, label: TextLayerEntry) {
    const project = useProjectStore()
    let place: LabelPlace | undefined
    pushCommand({
      label: `add-label ${label.id}`,
      do: () => project.addLabel(pageId, label, place),
      undo: () => {
        place = project.deleteLabel(pageId, label.id) ?? undefined
      },
    })
    selectOnly(label.id)
  }

  /**
   * A new label is empty on both sides. It is placed where the pointer asked on
   * the side being worked on, and at the same place on the other — nothing has
   * been measured about either, so starting them apart would be inventing a
   * difference.
   */
  function addLabelAt(x: number, y: number) {
    const project = useProjectStore()
    if (!currentPageId.value) return
    const label = blankTextObject(generateLabelId(), project.header.seedStyle)
    label.source.x = x
    label.source.y = y
    label.translation.x = x
    label.translation.y = y
    cmdAddLabel(currentPageId.value, label)
  }

  /**
   * Everything a page's own court decided, as one step.
   *
   * ⭐ One step and not one per object. What somebody wants back after pressing
   * the button is the page as it was before they pressed it — undoing a run
   * eleven objects at a time would be eleven presses to reach a state nobody
   * asked to stop at.
   *
   * The new objects are built here rather than by the court, which answers
   * about the artwork and knows nothing about styles or identifiers.
   */
  function cmdApplyVerdict(pageId: string, verdict: Verdict) {
    const project = useProjectStore()
    if (verdict.fills.size === 0 && verdict.spawns.length === 0) return

    const page = project.pageById(pageId)?.page
    if (!page) return
    const seed = project.header.seedStyle

    const before = new Map<string, SourceBody>()
    const after = new Map<string, SourceBody>()
    for (const [id, filling] of verdict.fills) {
      const label = project.labelById(pageId, id)
      if (!label) continue
      before.set(id, label.source)
      after.set(id, {
        ...label.source,
        lines: linesOf(filling.text),
        from: filling.from,
        // ⚠️ Only the type, never the position. The object already stands where
        // it stands, and this is a correction to what it says.
        style: sourceStyle(label.source.style, filling, page),
      })
    }

    const born = verdict.spawns.map((spawn) => {
      const style = measuredStyle(seed, spawn)
      const read = sourceStyle(seed, spawn, page)
      const label = blankTextObject(generateLabelId(), style)
      label.source = { ...emptyBody(read), by: 'auto', lines: linesOf(spawn.text), from: spawn.from }
      // Placed by where the reading was, which is the middle of the balloon.
      const source = anchorFor(read, spawn.centre)
      const translation = anchorFor(style, spawn.centre)
      label.source.x = source.x
      label.source.y = source.y
      label.translation.x = translation.x
      label.translation.y = translation.y
      return label
    })

    const places = new Map<string, LabelPlace>()
    pushCommand({
      label: `recognize ${pageId}`,
      do: () => {
        for (const [id, source] of after) project.setLabelSource(pageId, id, source)
        for (const label of born) project.addLabel(pageId, label, places.get(label.id))
      },
      undo: () => {
        for (const label of born) {
          const place = project.deleteLabel(pageId, label.id)
          if (place) places.set(label.id, place)
        }
        for (const [id, source] of before) project.setLabelSource(pageId, id, source)
      },
    })
  }

  /**
   * Send a whole list off the page, or bring it back.
   *
   * ⭐ One step for the batch. What somebody is saying is "none of these", which
   * is one sentence and should cost one Ctrl+Z — and the reason the gesture is a
   * button rather than a row-by-row dismissal is that the unit being rejected is
   * the place, not the reading.
   */
  function cmdSetReadingsAside(pageId: string, hashes: readonly string[], aside: boolean) {
    if (hashes.length === 0) return
    const project = useProjectStore()
    pushCommand({
      label: `${aside ? 'set-aside' : 'take-back'} ${hashes.length}`,
      do: () => project.setReadingsAside(pageId, hashes, aside),
      undo: () => project.setReadingsAside(pageId, hashes, !aside),
    })
  }

  /**
   * A card put somewhere by hand.
   *
   * ⚠️ On the stack although the position itself is never saved. What Ctrl+Z
   * takes back is the last thing somebody did, and moving a card out of the way
   * is one of the things they do — a stack that skipped past it to undo an edit
   * they had finished with would be answering a question nobody asked.
   *
   * Applied first, as the drag writes through so the card keeps up with the
   * pointer; only the release reaches here.
   */
  function cmdMoveCard(
    key: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ) {
    if (from.x === to.x && from.y === to.y) return
    const cards = useCardStore()
    pushCommand(
      {
        label: `move-card ${key}`,
        do: () => cards.moveTo(key, to),
        undo: () => cards.moveTo(key, from),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * A reading dropped on an object that already had one: what it says changes,
   * and nothing else about it does.
   *
   * ⭐ Only the words. That object is already standing where it belongs, set the
   * way the artwork was measured — what somebody is saying by dropping on it is
   * "the contents are wrong", never "the position is". Moving it would answer a
   * question they did not ask, and lose a placement they may have made by hand.
   *
   * ⭐ Stamped `human` although the words came out of a recognizer. The fence
   * records who settled the matter rather than who typed it, and picking this
   * reading over the one the run chose is exactly the judgement a later rerun
   * must not quietly undo.
   *
   * The reading that was standing here needs no attention: nothing points at it
   * once `from` names another, and being pointed at is the whole of what kept it
   * off the page.
   */
  function cmdReplaceLabelSource(
    pageId: string,
    labelId: string,
    reading: { hash: string; text: string },
  ) {
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const entry = project.entryById(labelId)
    if (entry?.kind !== 'text') return
    const was = entry.source
    const before: SourceBody = { ...was, lines: [...was.lines], style: { ...was.style } }
    if (before.from === reading.hash) return
    const after: SourceBody = {
      ...before,
      lines: linesOf(reading.text),
      by: 'human',
      from: reading.hash,
    }
    pushCommand({
      label: `replace-source ${labelId}`,
      do: () => project.setLabelSource(pageId, labelId, after),
      undo: () => project.setLabelSource(pageId, labelId, before),
    })
  }

  /**
   * An object made where a reading was dropped, standing on that reading.
   *
   * ⭐ Set the way the artwork was measured *where it landed*, not where it was
   * read. Somebody dropping a row onto a balloon is saying "this sentence
   * belongs here", and how that balloon is set is a fact about the balloon —
   * taking the type from the place the words came off would set a horizontal
   * caption vertically because the balloon it was misread from happened to be.
   */
  function cmdAddLabelFromReading(
    pageId: string,
    at: { x: number; y: number },
    reading: { hash: string; text: string },
    measured: Typography,
  ) {
    const project = useProjectStore()
    const page = project.pageById(pageId)?.page
    if (!page) return
    const style = measuredStyle(project.header.seedStyle, measured)
    const read = sourceStyle(project.header.seedStyle, measured, page)
    const label = blankTextObject(generateLabelId(), style)
    label.source = {
      ...emptyBody(read),
      by: 'auto',
      lines: linesOf(reading.text),
      from: reading.hash,
    }
    // Placed by its middle, as a run's own objects are.
    const source = anchorFor(read, at)
    const translation = anchorFor(style, at)
    label.source.x = source.x
    label.source.y = source.y
    label.translation.x = translation.x
    label.translation.y = translation.y
    cmdAddLabel(pageId, label)
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
      before.set(p, [...(project.pageById(p)?.page.readingOrder ?? [])])
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
        // A line whose both ends made the same journey is still saying something
        // true, so it travels with them. One that had an end left behind is not:
        // ids only mean anything within a page, so there is nothing for it to
        // point at any more, and dropping it is the honest answer.
        const landed = new Set(removed.flatMap((r) => textObjects([r.entry]).map((t) => t.id)))
        project.addReadingEdges(
          page,
          removed.flatMap((r) => r.edges).filter((e) => landed.has(e.from) && landed.has(e.to)),
        )
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
    if (cursorId.value !== null && wanted.has(cursorId.value)) currentPageId.value = page
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
    const page = currentPageId.value
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
    pageId: string,
    label: TextLayerEntry,
    opts?: { alreadyApplied?: boolean },
  ) {
    const project = useProjectStore()
    let place: LabelPlace | undefined
    pushCommand(
      {
        label: `duplicate-label ${label.id}`,
        do: () => project.addLabel(pageId, label, place),
        undo: () => {
          place = project.deleteLabel(pageId, label.id) ?? undefined
        },
      },
      opts,
    )
    selectOnly(label.id)
  }


  
  function cmdMoveLabel(
    pageId: string,
    labelId: string,
    side: TextSide,
    oldPos: { x: number; y: number },
    newPos: { x: number; y: number },
  ) {
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    pushCommand(
      {
        label: `move-label ${labelId}`,
        do: () => project.moveLabel(pageId, labelId, side, newPos.x, newPos.y),
        undo: () => project.moveLabel(pageId, labelId, side, oldPos.x, oldPos.y),
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
    pageId: string,
    layerId: string,
    from: LayerPlace,
    to: LayerPlace,
  ) {
    if (isLayerLocked(layerId)) return
    const project = useProjectStore()
    pushCommand({
      label: `place-layer ${layerId}`,
      do: () => project.placeLayer(pageId, layerId, to),
      undo: () => project.placeLayer(pageId, layerId, from),
    })
  }

  /**
   * The angle and the position travel together, because a turn around anything
   * but the object's own middle swings it across the page as well as spinning
   * it — putting the angle back alone would leave it lying right and standing
   * somewhere else.
   */
  function cmdRotateLabel(
    pageId: string,
    labelId: string,
    side: TextSide,
    from: TurnedLabel,
    to: TurnedLabel,
  ) {
    if (JSON.stringify(from) === JSON.stringify(to) || isLayerLocked(labelId)) return
    const project = useProjectStore()
    const apply = (state: TurnedLabel) => {
      project.rotateLabel(pageId, labelId, side, state.rotation)
      project.moveLabel(pageId, labelId, side, state.x, state.y)
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
    pageId: string,
    labelId: string,
    side: TextSide,
    from: ScaledLabel,
    to: ScaledLabel,
  ) {
    if (JSON.stringify(from) === JSON.stringify(to)) return
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const apply = (state: ScaledLabel) => {
      project.setLabelStyle(pageId, labelId, side, state.style)
      project.moveLabel(pageId, labelId, side, state.x, state.y)
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
  function cmdAddRasterLayer(pageId: string, layer: RasterLayerEntry, path?: number[]) {
    const project = useProjectStore()
    let removed: RemovedEntry | null = null
    pushCommand({
      label: `add-layer ${layer.id}`,
      do: () => {
        if (removed === null) project.addLayer(pageId, layer, path)
        else project.restoreEntry(removed)
      },
      undo: () => {
        removed = project.removeEntry(layer.id)
      },
    })
    selectOnly(layer.id)
  }

  function cmdAddFolder(pageId: string, name: string) {
    const project = useProjectStore()
    const folder: GroupLayerEntry = {
      kind: 'group',
      id: generateLabelId(),
      name,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: PASS_THROUGH,
      effects: [],
      children: [],
    }
    let path: number[] | undefined
    pushCommand({
      label: `add-folder ${folder.id}`,
      do: () => project.addLayer(pageId, folder, path),
      undo: () => {
        const removed = project.dissolveFolder(pageId, folder.id)
        path = removed?.path
      },
    })
  }

  /**
   * Dissolving rather than deleting: a folder is pure containment, so taking
   * one away has to leave what it held behind. There is no way to lose a
   * translation by tidying up.
   */
  function cmdDissolveFolder(pageId: string, folderId: string) {
    if (isLayerLocked(folderId)) return
    const project = useProjectStore()
    const removed = project.dissolveFolder(pageId, folderId)
    if (removed === null) return
    pushCommand(
      {
        label: `dissolve-folder ${folderId}`,
        do: () => {
          project.dissolveFolder(pageId, folderId)
        },
        undo: () => project.restoreFolder(pageId, removed.path, removed.folder),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * Applied first so a refused drop — a folder aimed into itself — never
   * reaches the stack as an entry that undoes to nothing.
   */
  function cmdMoveLayer(
    pageId: string,
    layerId: string,
    fromPath: number[],
    target: DropTarget,
  ) {
    if (isLayerLocked(layerId)) return
    const project = useProjectStore()
    // What a folder holds is part of the folder, so a drop into a locked one is
    // a change to it — and moving out of a locked folder is already refused
    // above, since the entry inherits that lock.
    const file = project.pageById(pageId)
    const into = file ? folderAtPath(file.page.layers, target.parentPath) : null
    if (into !== null && isLayerLocked(into.id)) return
    if (!project.moveLayer(pageId, fromPath, target)) return
    pushCommand(
      {
        label: `move-layer ${layerId}`,
        do: () => project.moveLayer(pageId, fromPath, target),
        undo: () => project.restoreLayerAt(pageId, layerId, fromPath),
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
    const file = project.pageById(page)
    return file ? isLocked(file.page.layers, id) : false
  }

  /** Whatever is selected that a change is still allowed to reach. */
  function unlockedSelection(): string[] {
    return [...selectedIds.value].filter((id) => !isLayerLocked(id))
  }

  /**
   * Everything the panel was showing, in one step of history — as with
   * deleting, dimming five layers is one act and five entries to undo would say
   * it was five.
   *
   * `before` is what those nodes were when the drag began rather than something
   * reconstructed afterwards, by which time they have already moved: the slider
   * writes straight through so the page keeps up with the hand, and only the
   * release enters the stack.
   */
  function cmdSetOpacity(
    before: readonly { pageId: string; id: string; opacity: number }[],
    opacity: number,
  ) {
    const moved = before.filter((was) => was.opacity !== opacity && !isLayerLocked(was.id))
    if (moved.length === 0) return
    const project = useProjectStore()
    pushCommand(
      {
        label: `set-opacity ${moved.length}`,
        do: () => {
          for (const { pageId, id } of moved) project.setLayerOpacity(pageId, id, opacity)
        },
        undo: () => {
          for (const { pageId, id, opacity: was } of moved)
            project.setLayerOpacity(pageId, id, was)
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
  function cmdSetBlendMode(
    before: readonly { pageId: string; id: string; blendMode: string }[],
    blendMode: string,
  ) {
    const project = useProjectStore()
    const moved: { pageId: string; id: string; blendMode: string }[] = []
    for (const was of before) {
      if (was.blendMode === blendMode || isLayerLocked(was.id)) continue
      if (!project.setLayerBlendMode(was.pageId, was.id, blendMode)) continue
      moved.push(was)
    }
    if (moved.length === 0) return
    pushCommand(
      {
        label: `set-blend-mode ${moved.length}`,
        do: () => {
          for (const { pageId, id } of moved) project.setLayerBlendMode(pageId, id, blendMode)
        },
        undo: () => {
          for (const { pageId, id, blendMode: was } of moved)
            project.setLayerBlendMode(pageId, id, was)
        },
      },
      { alreadyApplied: true },
    )
  }

  function cmdRenameLayer(pageId: string, layerId: string, from: string, to: string) {
    if (from === to || isLayerLocked(layerId)) return
    const project = useProjectStore()
    // Applied first, as a restack is: a name the tree refuses — a text object
    // has none to change — must not reach the stack as an entry that undoes to
    // nothing.
    if (!project.renameLayer(pageId, layerId, to)) return
    pushCommand(
      {
        label: `rename-layer ${layerId}`,
        do: () => project.renameLayer(pageId, layerId, to),
        undo: () => project.renameLayer(pageId, layerId, from),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * The one change a lock does not refuse — refusing it would leave no way to
   * take the lock off again.
   */
  function cmdSetLayerLocked(pageId: string, layerId: string, locked: boolean) {
    const project = useProjectStore()
    pushCommand({
      label: `set-locked ${layerId}`,
      do: () => project.setLayerLocked(pageId, layerId, locked),
      undo: () => project.setLayerLocked(pageId, layerId, !locked),
    })
  }

  /**
   * Inside the lock, unlike the eye and unlike the lock itself: this one decides
   * where paint may land, which is the very thing a lock is put on to hold
   * still.
   *
   * Applied first, as a rename is: the tree refuses this on anything but a
   * raster, and a refusal must not reach the stack as a step that undoes to
   * nothing.
   */
  function cmdSetLayerAlphaLocked(pageId: string, layerId: string, alphaLocked: boolean) {
    if (isLayerLocked(layerId)) return
    const project = useProjectStore()
    if (!project.setLayerAlphaLocked(pageId, layerId, alphaLocked)) return
    pushCommand(
      {
        label: `set-alpha-locked ${layerId}`,
        do: () => project.setLayerAlphaLocked(pageId, layerId, alphaLocked),
        undo: () => project.setLayerAlphaLocked(pageId, layerId, !alphaLocked),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * Left out of the lock deliberately: the eye is a control for looking rather
   * than for changing, and a locked layer that could not be turned off for a
   * moment to see what is under it would be frozen rather than protected. The
   * same exception Photoshop, Krita and Clip Studio all make.
   */
  function cmdSetLayerVisible(pageId: string, layerId: string, visible: boolean) {
    const project = useProjectStore()
    pushCommand({
      label: `set-visible ${layerId}`,
      do: () => project.setLayerVisible(pageId, layerId, visible),
      undo: () => project.setLayerVisible(pageId, layerId, !visible),
    })
  }

  /**
   * A lock that still lets the words be retyped is not protecting the thing it
   * was put on, so this refuses like every other change rather than being the
   * one exception content slips through.
   *
   * ⭐ The one door for typing into an object, whichever surface the caret is
   * on. Both of them reach a translation through whichever row it is reading, so
   * both leave the same two marks — the words, and the amulet saying somebody
   * has taken those words as their own. It used to depend on where the hand was,
   * which made the same sentence, from the same person, protected or not by an
   * accident of which panel they were looking at.
   *
   * ⚠️ The amulet goes on at the keystroke and comes off here, so an undo hands
   * an untouched proposal back to the model that made it.
   */
  function cmdUpdateLabelText(
    pageId: string,
    labelId: string,
    side: TextSide,
    oldText: string,
    newText: string,
    wasTheirs?: boolean,
  ) {
    if (oldText === newText || isLayerLocked(labelId)) return
    const project = useProjectStore()
    const held = chosenCandidate(pageId, labelId, side)
    // ⚠️ Read now only for a caller that has not written anything through yet.
    // An editing session has, and stamped as it went, so it carries the answer
    // from before the first keystroke.
    const was = wasTheirs ?? held?.human === true
    pushCommand({
      label: `update-text ${labelId}`,
      do: () => project.updateLabelText(pageId, labelId, side, newText),
      undo: () => {
        project.updateLabelText(pageId, labelId, side, oldText)
        if (held) project.setTranslationHand(pageId, labelId, held.id, was)
      },
    })
  }

  /**
   * A correction to what a model read.
   *
   * ⚠️ Gated on nothing, where the object side is gated on the layer's lock. A
   * reading belongs to no layer and stands on no canvas — it is evidence about
   * the artwork, and there is nothing here that locking could have meant.
   */
  function cmdUpdateReadingText(pageId: string, hash: string, oldText: string, newText: string) {
    if (oldText === newText) return
    const project = useProjectStore()
    pushCommand({
      label: `update-reading ${hash}`,
      do: () => project.setReadingText(pageId, hash, newText),
      undo: () => project.setReadingText(pageId, hash, oldText),
    })
  }

  /** The proposal an object is reading, when it is reading one. */
  function chosenCandidate(
    pageId: string,
    labelId: string,
    side: TextSide,
  ): TranslationCandidate | null {
    if (side !== 'translation') return null
    const project = useProjectStore()
    const body = project.labelById(pageId, labelId)?.translation
    if (!body || body.chosen === null) return null
    return body.candidates.find((c) => c.id === body.chosen) ?? null
  }

  /**
   * Which line an object reads as. `null` is the lines it was typed with.
   *
   * ⚠️ On the stack, unlike the panel this replaces, which wrote straight
   * through. Picking is the decision the whole list exists to make, and a Ctrl+Z
   * that skipped past it to take back the sentence before would be undoing the
   * wrong thing at the one moment somebody is sure what they just did.
   */
  function cmdPickTranslation(pageId: string, labelId: string, id: string | null) {
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const was = project.labelById(pageId, labelId)?.translation.chosen ?? null
    if (was === id) return
    pushCommand({
      label: `pick-translation ${labelId}`,
      do: () => project.setLabelTranslation(pageId, labelId, id),
      undo: () => project.setLabelTranslation(pageId, labelId, was),
    })
  }

  /**
   * A candidate somebody asked for: blank, theirs, and already being read.
   *
   * ⭐ Blank rather than a copy of what is showing. A copy arrives already
   * saying something, and a row that says something nobody wrote is one somebody
   * has to read before they can dismiss it. Picked straight away, since asking
   * for a blank and then having to go and find it says the request meant
   * nothing.
   *
   * ⚠️ The id comes from the caller so that redo brings back the same proposal
   * rather than a twin of it — the chosen slot names it, and a fresh id would
   * leave that slot pointing at nothing.
   */
  function cmdAddTranslationCandidate(pageId: string, labelId: string, id: string) {
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const body = project.labelById(pageId, labelId)?.translation
    if (!body) return
    const at = body.candidates.length
    const was = body.chosen
    pushCommand({
      label: `add-translation ${labelId}`,
      do: () => {
        project.insertTranslation(pageId, labelId, { id, lines: [''], human: true }, at)
        project.setLabelTranslation(pageId, labelId, id)
      },
      undo: () => {
        project.setLabelTranslation(pageId, labelId, was)
        project.removeTranslation(pageId, labelId, id)
      },
    })
  }

  /**
   * A candidate thrown away.
   *
   * ⭐ Deleting the one being read drops the object back to its own typed lines
   * rather than to another proposal. What those lines are is the last thing
   * anybody chose for themselves; picking the next proposal along would be the
   * program making a choice out of the deletion, which said nothing about it.
   */
  function cmdRemoveTranslation(pageId: string, labelId: string, id: string) {
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const body = project.labelById(pageId, labelId)?.translation
    const at = body?.candidates.findIndex((c) => c.id === id) ?? -1
    if (!body || at === -1) return
    const was = { ...body.candidates[at], lines: [...body.candidates[at].lines] }
    const chosen = body.chosen
    pushCommand({
      label: `remove-translation ${labelId}`,
      do: () => project.removeTranslation(pageId, labelId, id),
      undo: () => {
        project.insertTranslation(pageId, labelId, was, at)
        project.setLabelTranslation(pageId, labelId, chosen)
      },
    })
  }

  /**
   * Everything selected that a change is allowed to reach, with the page each
   * one is on — every kind of node, not only text.
   *
   * The one answer to "what is this batch", so that the panel a person reads and
   * the command that writes cannot be looking at two different lists. Handing a
   * command the selection to go and ask about itself is what lets those two
   * drift: the day the panel offers less than the whole selection, the write
   * would silently still take all of it.
   */
  function selectedNodes(): AppearanceTarget<LayerEntry>[] {
    const project = useProjectStore()
    const out: AppearanceTarget<LayerEntry>[] = []
    for (const id of unlockedSelection()) {
      const pageId = project.pageOfEntry(id)
      if (pageId === null) continue
      const entry = project.entryById(id)
      if (entry) out.push({ pageId, entry })
    }
    return out
  }

  /** Every selected text object a change is allowed to reach, with its page. */
  function selectedTextObjects(): AppearanceTarget<TextLayerEntry>[] {
    return selectedNodes().filter(
      (t): t is AppearanceTarget<TextLayerEntry> => t.entry.kind === 'text',
    )
  }

  /**
   * How far a batch reaches, for the sentence shown before it runs. The
   * selection crosses pages and most of it may be somewhere nobody can see, so
   * an operation about to change forty objects on six pages has to say so.
   */
  const batchScope = computed(() => {
    const targets = selectedNodes()
    const pages = new Set(targets.map((t) => t.pageId))
    return {
      objects: targets.length,
      pages: pages.size,
      offPage: [...pages].some((p) => p !== currentPageId.value),
    }
  })

  /**
   * Which consumer this selection is for. The whole of what the outer panel
   * knows: it reads `kind` and nothing else about a node, so adding a section
   * to one consumer is not an edit here.
   *
   * A folder is its own answer rather than a mixture — it is one kind of thing
   * that has nothing of its own to adjust yet, which is a different sentence
   * from "these disagree about what they are".
   */
  const appearanceKind = computed<AppearanceKind>(() => {
    const kinds = new Set(selectedNodes().map((t) => t.entry.kind))
    if (kinds.size === 0) return 'none'
    if (kinds.size > 1) return 'mixed'
    return [...kinds][0]
  })

  /**
   * One act, however many objects it touched. Undoing a batch has to put every
   * one of them back at once — anything else would leave the selection half
   * changed, which is a state the user never asked for and cannot see.
   */
  function cmdApplyStyle(
    targets: readonly AppearanceTarget<TextLayerEntry>[],
    patch: Partial<TextStyle>,
  ) {
    const project = useProjectStore()
    if (targets.length === 0 || Object.keys(patch).length === 0) return
    const side = textSide.value
    const before = targets.map(({ pageId, entry }) => ({
      pageId,
      id: entry.id,
      style: { ...bodyOnSide(entry, side).style },
    }))
    const after = before.map((entry) => ({ ...entry, style: { ...entry.style, ...patch } }))
    const write = (states: typeof before) => {
      for (const { pageId, id, style } of states) project.setLabelStyle(pageId, id, side, style)
    }
    pushCommand({
      label: `style ${targets.length}`,
      do: () => write(after),
      undo: () => write(before),
    })
  }

  /**
   * The whole list at once rather than one effect at a time. What a node
   * carries is an ordered set — turning the stroke off is the same write as
   * changing its width — so a patch per effect would need a key to address one
   * by, and there is nothing to key on.
   */
  function cmdApplyEffects(
    targets: readonly AppearanceTarget[],
    effects: readonly LayerEffect[],
  ) {
    const project = useProjectStore()
    if (targets.length === 0) return
    const before = targets.map(({ pageId, entry }) => ({
      pageId,
      id: entry.id,
      effects: cloneEffects(entry.effects),
    }))
    const after = before.map((entry) => ({ ...entry, effects: cloneEffects(effects) }))
    const write = (states: typeof before) => {
      for (const { pageId, id, effects: value } of states)
        project.setLayerEffects(pageId, id, value)
    }
    pushCommand({
      label: `effects ${targets.length}`,
      do: () => write(after),
      undo: () => write(before),
    })
  }

  /**
   * Every text object in the chapter, which is what the statistics count.
   *
   * The translation whatever tool is open: what this feeds is the style a newly
   * tagged object is given, and that style is written to the translation.
   */
  function chapterBucketObjects(): BucketObject[] {
    const project = useProjectStore()
    return project.files.flatMap((file) =>
      bucketObjectsOf(file.pageId, file.page.layers, 'translation'),
    )
  }

  /**
   * Turning a tag on for a selection that already partly carries it means
   * putting it on the rest, not flipping each object separately: a control
   * showing one state has to end in one state, or a second click would undo
   * what the first appeared to do.
   *
   * The style follows the tags, taken from what the project already sets under
   * the meaning each object ends up with, and it overwrites whatever was there.
   * A deliberate pause rather than a settled trade: which edits should be
   * protected from this is a question only a chapter that has actually been
   * typeset can answer. What it costs is one undo — which is why the tags and
   * the styles are one command and not two.
   *
   * What triggers it is the tag set changing, so an object already carrying the
   * tag is left as it is: filling in the stragglers of a half-tagged selection
   * would otherwise overwrite the ones that were already right.
   *
   * Everything is derived from a sample read before anything is written, so a
   * batch lands the same way whatever order the objects come in, and no object
   * casts a vote in the meaning it is in the middle of joining.
   */
  function cmdToggleTagOnSelection(tag: string) {
    toggleTagOn(selectedTextObjects(), tag)
  }

  /**
   * The same act aimed by name rather than by what is selected, for a list that
   * already holds a group and would otherwise have to take the selection over
   * to say anything about it.
   */
  function cmdToggleTagOnObjects(ids: readonly string[], tag: string) {
    toggleTagOn(textObjectsByIds(ids), tag)
  }

  /** Every text object among these ids a change is allowed to reach. */
  function textObjectsByIds(ids: readonly string[]): AppearanceTarget<TextLayerEntry>[] {
    const project = useProjectStore()
    const out: AppearanceTarget<TextLayerEntry>[] = []
    for (const id of ids) {
      if (isLayerLocked(id)) continue
      const pageId = project.pageOfEntry(id)
      if (pageId === null) continue
      const entry = project.entryById(id)
      if (entry?.kind === 'text') out.push({ pageId, entry })
    }
    return out
  }

  function toggleTagOn(targets: AppearanceTarget<TextLayerEntry>[], tag: string) {
    const project = useProjectStore()
    if (targets.length === 0) return
    const adding = !targets.every(({ entry }) => entry.tags.includes(tag))
    const before = targets.map(({ pageId, entry }) => ({
      pageId,
      id: entry.id,
      tags: [...entry.tags],
      style: { ...entry.translation.style },
    }))
    const sample = chapterBucketObjects()
    const { tags: registry, seedStyle } = project.header
    const after = before.map((entry) => {
      const tags = adding ? withTag(entry.tags, tag) : withoutTag(entry.tags, tag)
      if (sameTagSet(entry.tags, tags)) return entry
      return { ...entry, tags, style: deriveStyle(sample, tags, registry, seedStyle) }
    })
    const write = (states: typeof before) => {
      for (const { pageId, id, tags, style } of states) {
        project.setLabelTags(pageId, id, tags)
        project.setLabelStyle(pageId, id, 'translation', style)
      }
    }
    pushCommand({
      label: `${adding ? 'tag' : 'untag'} ${tag} ${targets.length}`,
      do: () => write(after),
      undo: () => write(before),
    })
  }

  /**
   * A gesture's worth of spraying, however many objects it crossed — crossing
   * five in one sweep is one thing that happened.
   *
   * The load replaces what an object carried rather than joining it. A brush
   * holds a whole meaning, and adding would build combinations nobody chose,
   * which is the drift the buckets exist to find; changing one part of a meaning
   * an object already has is what ticking against a selection is for. Taking a
   * meaning away is this same stroke with nothing loaded.
   *
   * The style follows on the terms `cmdToggleTagOnSelection` sets: derived from
   * a sample read before anything is written, and in one command with the tags.
   */
  function cmdPaintTags(ids: readonly string[], tags: readonly string[]) {
    const project = useProjectStore()
    const wanted = normalizeTagSet(tags)
    const targets = textObjectsByIds(ids).filter(
      ({ entry }) => !sameTagSet(entry.tags, wanted),
    )
    if (targets.length === 0) return

    const before = targets.map(({ pageId, entry }) => ({
      pageId,
      id: entry.id,
      tags: [...entry.tags],
      style: { ...entry.translation.style },
    }))
    const sample = chapterBucketObjects()
    const { tags: registry, seedStyle } = project.header
    const style = deriveStyle(sample, wanted, registry, seedStyle)
    const after = before.map((entry) => ({ ...entry, tags: wanted, style }))
    const write = (states: typeof before) => {
      for (const state of states) {
        project.setLabelTags(state.pageId, state.id, state.tags)
        project.setLabelStyle(state.pageId, state.id, 'translation', state.style)
      }
    }
    pushCommand({
      label: `paint-tags ${targets.length}`,
      do: () => write(after),
      undo: () => write(before),
    })
  }

  /**
   * A gesture's worth of lines, however many it drew — connecting five objects
   * in one sweep is one thing that happened, and five entries to undo would say
   * it was five.
   *
   * Applied first, like a restack: the lines a page refuses — a ring, or one
   * already drawn — must not reach the stack as an entry that undoes to
   * nothing. What is recorded is what the page actually took, so taking the
   * gesture back cannot rub out a line that was there before it.
   */
  function cmdDrawReadingEdges(pageId: string, edges: readonly ReadingEdge[]) {
    const project = useProjectStore()
    // Where an object is read is one of the things a lock is put on to hold
    // still, and a line is a statement about exactly that.
    const allowed = edges.filter((e) => !isLayerLocked(e.from) && !isLayerLocked(e.to))
    const taken = project.addReadingEdges(pageId, allowed)
    if (taken.length === 0) return
    pushCommand(
      {
        label: `draw-reading-edges ${taken.length}`,
        do: () => {
          project.addReadingEdges(pageId, taken)
        },
        undo: () => project.removeReadingEdges(pageId, taken),
      },
      { alreadyApplied: true },
    )
  }

  function cmdEraseReadingEdges(pageId: string, edges: readonly ReadingEdge[]) {
    const project = useProjectStore()
    const held = project.readingEdgesOf(pageId)
    const going = edges.filter(
      (e) => hasEdge(held, e) && !isLayerLocked(e.from) && !isLayerLocked(e.to),
    )
    if (going.length === 0) return
    pushCommand({
      label: `erase-reading-edges ${going.length}`,
      do: () => project.removeReadingEdges(pageId, going),
      undo: () => {
        project.addReadingEdges(pageId, going)
      },
    })
  }

  function cmdSetLabelTags(pageId: string, labelId: string, from: string[], to: string[]) {
    if (sameTagSet(from, to) || isLayerLocked(labelId)) return
    const project = useProjectStore()
    pushCommand({
      label: `set-tags ${labelId}`,
      do: () => project.setLabelTags(pageId, labelId, to),
      undo: () => project.setLabelTags(pageId, labelId, from),
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
        undo: () => {
          project.removeTagAt(index)
        },
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
        do: () => {
          project.removeTagAt(index)
        },
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

  /**
   * A drop in the page grid. Reordering is the easiest thing to do by accident
   * and the hardest to notice, and putting an array back is free. Making pages
   * stays off the stack — it reads source images and writes directories, which
   * this interface has no way to reverse.
   *
   * Held by neighbour rather than by index: a page deleted afterwards drops out
   * of the list, so an index recorded now may not mean the same place later.
   */
  function cmdMovePage(pageId: string, to: number) {
    const project = useProjectStore()
    const ids = project.files.map((f) => f.pageId)
    const from = ids.indexOf(pageId)
    if (from === -1 || from === to) return
    const back = ids[from + 1] ?? null
    const forward = ids.filter((id) => id !== pageId)[to] ?? null
    pushCommand({
      label: `move-page ${pageId}`,
      do: () => project.movePageBefore(pageId, forward),
      undo: () => project.movePageBefore(pageId, back),
    })
  }

  /**
   * Deletes pages, which means marking them — the directories stay, so this is
   * a memory operation and belongs on the stack like any other.
   *
   * One command for the whole batch, however many pages were picked: one act by
   * the hand should cost one Ctrl+Z, and the stack is bounded, so a page each
   * would let deleting a chapter push the whole session's work off the bottom.
   *
   * The command carries what was really marked rather than what was asked for.
   * An undo has to take back what happened, and a page already gone from the
   * chapter never happened.
   */
  function cmdDeletePages(pageIds: readonly string[]): string[] {
    const project = useProjectStore()
    const deleted = project.tagPagesDeleted(pageIds)
    if (deleted.length === 0) return []
    pushCommand(
      {
        label: `delete-pages ${deleted.length}`,
        do: () => {
          project.tagPagesDeleted(deleted)
        },
        undo: () => project.untagPagesDeleted(deleted),
      },
      { alreadyApplied: true },
    )
    return deleted
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
    currentPageId,
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
    textSide,
    setTextSide,
    foreground,
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
    strokeInFlight,
    beginStroke,
    finishStroke,
    startOnPage,
    pageBy,
    selectLabelBy,
    selectLayerBy,
    revealLabel,
    pendingTextEdit,
    beginTextEdit,
    commitTextEdit,
    flushTextEdit,
    pendingReadingEdit,
    beginReadingEdit,
    editBy,
    pushCommand,
    forgetJournals,
    undo,
    redo,
    clearHistory,
    closeBook,
    cmdSetPageOrder,
    cmdImportPages,
    addLabelAt,
    addLabelAtViewCenter,
    deleteSelection,
    moveObjectsTo,
    cmdAddLabel,
    cmdApplyVerdict,
    cmdSetReadingsAside,
    cmdAddLabelFromReading,
    cmdReplaceLabelSource,
    cmdMoveCard,
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
    cmdSetLayerAlphaLocked,
    isLayerLocked,
    cmdRenameLayer,
    cmdSetOpacity,
    cmdSetBlendMode,
    cmdUpdateLabelText,
    cmdPickTranslation,
    cmdAddTranslationCandidate,
    cmdRemoveTranslation,
    selectedNodes,
    selectedTextObjects,
    batchScope,
    appearanceKind,
    cmdApplyStyle,
    cmdApplyEffects,
    cmdToggleTagOnSelection,
    cmdToggleTagOnObjects,
    cmdPaintTags,
    paintTags,
    loadPaintTags,
    cmdDrawReadingEdges,
    cmdEraseReadingEdges,
    cmdSetLabelTags,
    cmdAddTag,
    cmdRemoveTag,
    cmdRenameTag,
    cmdMoveTag,
    cmdMovePage,
    cmdDeletePages,
  }
})
