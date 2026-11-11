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
import { useZoomPan, type Area, type Size } from '@/composables/useZoomPan'
import type { ProjectFile } from '@/types/project'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useCardStore } from '@/stores/cardStore'
import { useNoticeStore } from '@/stores/noticeStore'
import {
  useProjectStore,
  type FaceState,
  type PageStructure,
  type TranslationParts,
} from '@/stores/projectStore'
import { clamp } from '@/lib/coords'
import { blankTranslation, generateId as generateLabelId } from '@shared/page/schema'
import { linesOf, type TextSide } from '@shared/page/text'
import {
  isOnView,
  blocksOf,
  chosenCandidateOf,
  facePage,
  shownCodeOf,
  sourceBlocksOf,
  tagsOfUnit,
  type FacePage,
} from '@shared/page/units'
import { escapeText } from '@shared/page/markup'
import type { TranslationTextLayerEntry } from '@shared/page/types'
import { nextAutoName } from '@/lib/autoName'
import { folderAtPath, isLocked, pathOf, textObjects } from '@shared/page/tree'
import { restackOrder, type Restack } from '@/lib/layerOrder'
import { draftOf, everyEntry, snapshotTrees, textOnPage, treeOf } from '@shared/page/trees'
import { adoptSources, canDetach, detach, planRelink, relink, type RelinkPlan } from '@shared/page/relink'
import { numberPage } from '@shared/page/numbers'
import { hasEdge, type ReadingEdge } from '@shared/page/readingGraph'
import { flattenLayerRows } from '@/lib/layerRows'
import type { LayerPlace } from '@/lib/layerTransform'
import { buildLabelRows, chapterStops, type ChapterRow } from '@/lib/labelRows'
import type { AppearanceKind, AppearanceTarget } from '@/lib/appearance'
import type { MaskBrushMode } from '@/lib/selection/brushMask'
import type { MaskTarget } from '@/lib/selection/mask'
import type { DropTarget } from '@shared/page/tree'
import type { TextStyle } from '@shared/text-style/types'
import type { LayerEffect, StrokeEffect } from '@shared/effects/types'
import { cloneEffects } from '@shared/effects/clone'
import { withStrokes } from '@shared/effects/stroke'
import { sameTagSet, withTag, withoutTag } from '@shared/tags/set'
import type { Typography, Verdict } from '@shared/ocr/decide'
import { drawnLabel } from '@/lib/labelRaster'
import { logActivity } from '@/lib/activityLog'

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
  /** What the step did, for the activity log: the words before and after, a style's patch. */
  detail?: Record<string, unknown>
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
  flipX: boolean
  flipY: boolean
}

/** Everything a gesture on a multiple selection can leave changed about one member. */
export interface PlacedLabel {
  style: TextStyle
  x: number
  y: number
  rotation: number
  flipX: boolean
  flipY: boolean
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
 * the second one — sweeping a marquee over objects — because a general move
 * tool that grew it would be answering questions about text while somebody is
 * nudging an erase patch.
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
  | 'remove'

/** The tools whose drag builds a selection rather than acting on objects. */
export const SELECTION_TOOLS = [
  'marquee-rect',
  'marquee-ellipse',
  'lasso',
  'lasso-polygon',
  'wand',
  'brush',
  'eraser',
  'remove',
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
  // Coverage laid down like the brush's, so it takes the brush's head and keys.
  remove: 'paint',
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

/** What a material hands a new sentence: its words, its style, its effects. */
export interface MaterialGives {
  text: string | null
  patch: Partial<TextStyle>
  effects: readonly LayerEffect[] | null
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
   * Turn to the page an object lives on — for a plain click only. Adding to a
   * selection or taking out of one leaves the page where it is: a selection
   * reaches across pages, and reaching for an object on another one, as a
   * sample to carry back here, is not asking to go and look at it.
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
  }

  /** What a sweep leaves selected, in one step, the cursor on the last object caught. */
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
  }

  /**
   * What the label list is being narrowed to. Held here because moving up and
   * down has to walk what is on screen, and what is on screen is whatever
   * survived this.
   */
  const labelQuery = ref('')

  /** The label list as it is being shown, filter and all. */
  /**
   * The label list as it stands, built once for the list to draw and every
   * step through it to walk: rebuilt on each step, a held key spent its frames
   * relaying out the whole chapter.
   */
  const chapterRows = computed<ChapterRow[]>(() =>
    buildLabelRows(useProjectStore().files, textSide.value, useProjectStore().activeFace, labelQuery.value),
  )

  function shownRows(): ChapterRow[] {
    return chapterRows.value
  }

  /**
   * Which folders are closed. Held here rather than in the tree because moving
   * the cursor by keyboard has to know what is on screen, and a folder that is
   * shut has nothing on screen to move onto.
   */
  const collapsedLayerIds = ref<Set<string>>(new Set())

  const tool = ref<CanvasTool>('select')

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
   * Every text object off the canvas at once, for looking at the artwork under
   * it. A switch on the view alone: no object's own visibility is touched, so
   * one that was already hidden is still hidden when the text comes back.
   * Session state, and the export never reads it.
   */
  const textsHidden = ref(false)

  /**
   * The canvas showing the original artwork alone, everything above it left
   * out. Like `textsHidden`, a switch on the view: nothing on the page changes.
   */
  const showingOriginal = ref(false)

  /** Every text object tinted and stamped with its tags on the canvas. A switch on the view, like `textsHidden`. */
  const tagsShown = ref(false)

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
  /** Where the page is shown, when that is not where it lies — the split page's pieces, pushed apart. */
  const viewFitArea = ref<Area | null>(null)
  const { view, fitToView, wheelZoom, zoomBy, panBy, rotateTo } = useZoomPan(
    viewContainerSize,
    viewContentSize,
    viewFitArea,
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

  /**
   * How many things the hand has done to the history: a step taken, undone,
   * redone, or the stack wiped. Trimming what falls off the bottom is not one.
   * A brush's line start holds only while this has not moved.
   */
  const historyStep = ref(0)

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
        ? r.blocks.some((b) => b.id === cursorId.value)
        : r.kind === 'block'
          ? r.block.id === cursorId.value
          : cursorId.value === null && r.pageId === currentPageId.value,
    )
    const next = at === -1 ? (offset > 0 ? 0 : stops.length - 1) : at + offset
    if (next < 0 || next >= stops.length) return

    const row = stops[next]
    if (row.kind === 'label' || row.kind === 'block') {
      const id = row.kind === 'block' ? row.block.id : row.blocks[0]?.id
      if (id === undefined) return
      selectOnly(id)
      showPageOf(id)
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
    const rows = flattenLayerRows(treeOf(file.page, textSide.value, project.activeFace), collapsedLayerIds.value, textSide.value, project.activeFace)
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
    const page = project.pageById(pending.pageId)?.page
    const label = project.blockById(pending.pageId, pending.labelId)
    return page === undefined || label === undefined
      ? undefined
      : shownCodeOf(label)
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
    const wasTheirs = chosenCandidate(pageId, labelId)?.human === true
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
    cmdUpdateLabelText(pending.pageId, pending.labelId, pending.from, text, pending.wasTheirs)
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
    const project = useProjectStore()
    const manifest = project.pageById(page)?.page
    const label = project.blockById(page, id)
    if (!label || !manifest) return
    beginTextEdit(page, id, shownCodeOf(label))
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
   * A command that names its pages and leaves out the one being typed on only
   * banks what was typed, which keeps that order without ending the visit — a
   * page read in the background is no reason to take the keyboard away.
   *
   * Answers whether the command joined the stack. A command that is not
   * `alreadyApplied` runs its own `do()` right here, and a `false` back from
   * that means the write was refused — nothing is pushed, since there is
   * nothing yet to undo.
   */
  function pushCommand(
    cmd: Command,
    opts?: { alreadyApplied?: boolean; book?: BookId; pages?: readonly string[] },
  ): boolean {
    const typing = pendingTextEdit.value
    if (typing !== null && opts?.pages !== undefined && !opts.pages.includes(typing.pageId)) flushTextEdit()
    else commitTextEdit()
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
    pushedAt.set(cmd, ++pushes)
    setHistory(book, { undo: kept, redo: [] })
    historyStep.value++
    logActivity('step', { label: cmd.label, ...cmd.detail })
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
    historyStep.value++
    logActivity('undo', { label: cmd.label })
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
    historyStep.value++
    logActivity('redo', { label: cmd.label })
    settleBook(cmd, book)
  }

  /**
   * Every pushed step's place in the order steps were taken, for `foldSince`.
   * A count rather than the stack's length: a step pushed onto a full stack
   * trims the oldest, so a length read before a gesture names the wrong place
   * once the gesture has landed.
   */
  const pushedAt = new WeakMap<Command, number>()
  let pushes = 0

  /** Where the history stands now, to fold back to. */
  function historyMark(): number {
    return pushes
  }

  /**
   * Everything taken onto the current book's history since it stood at
   * `mark`, made one step — a gesture whose parts land as separate commands
   * but are one act to the hand, so one undo takes it back. `keepIf` says
   * whether the run is worth keeping at all; one that is not is taken back
   * now, and leaves nothing to redo.
   */
  function foldSince(
    mark: number,
    label: string,
    keepIf: (steps: readonly Command[]) => boolean = () => true,
  ) {
    const book = currentBook.value
    const history = historyOf(book)
    let depth = history.undo.length
    while (depth > 0 && (pushedAt.get(history.undo[depth - 1]!) ?? 0) > mark) depth--
    const steps = history.undo.slice(depth)
    if (steps.length === 0) return
    if (!keepIf(steps)) {
      for (const cmd of [...steps].reverse()) {
        cmd.undo()
        cmd.forget?.()
      }
      setHistory(book, { undo: history.undo.slice(0, depth), redo: history.redo })
      historyStep.value++
      return
    }
    if (steps.length === 1) return
    const one: Command = {
      label,
      journals: steps.flatMap((cmd) => cmd.journals ?? []),
      do: () => {
        for (const cmd of steps) if (cmd.do() === false) return false
      },
      undo: () => {
        for (const cmd of [...steps].reverse()) if (cmd.undo() === false) return false
      },
      forget: () => {
        for (const cmd of steps) cmd.forget?.()
      },
    }
    setHistory(book, { undo: [...history.undo.slice(0, depth), one], redo: history.redo })
  }

  /** Wipes the current book's stack — nothing else's. */
  function clearHistory() {
    const book = currentBook.value
    const history = historyOf(book)
    for (const gone of [...history.undo, ...history.redo]) gone.forget?.()
    setHistory(book, { undo: [], redo: [] })
    historyStep.value++
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

  /**
   * A step that changes which blocks pages have or which sentences they make,
   * recorded as each page's structure before and after. The first run does the
   * work; a redo writes the after back, since running the work again would
   * mint new ids for what the steps above it already name.
   */
  function cmdReshapePages(label: string, pageIds: readonly string[], mutate: () => boolean | void): boolean {
    const project = useProjectStore()
    const snap = () => new Map(pageIds.flatMap((p) => {
      const s = project.structureOf(p)
      return s === undefined ? [] : [[p, s] as const]
    }))
    let before: Map<string, PageStructure> | undefined
    let after: Map<string, PageStructure> | undefined
    return pushCommand({
      label,
      do: () => {
        if (after !== undefined) {
          for (const [p, s] of after) project.setPageStructure(p, s)
          return
        }
        before = snap()
        if (before.size === 0 || mutate() === false) return false
        for (const p of pageIds) project.renumber(p)
        after = snap()
      },
      undo: () => {
        for (const [p, s] of before ?? []) project.setPageStructure(p, s)
      },
    }, { pages: pageIds })
  }

  function cmdReshape(label: string, pageId: string, mutate: () => boolean | void): boolean {
    return cmdReshapePages(label, [pageId], mutate)
  }

  function cmdAddLabel(pageId: string, parts: TranslationParts): string | null {
    const project = useProjectStore()
    const unitId = parts.units[project.activeFace]?.id ?? ''
    if (!cmdReshape(`add-label ${unitId}`, pageId, () => project.addLabel(pageId, parts))) return null
    const first =
      parts.blocks.find((b) => b.side === textSide.value && (b.side === 'source' || b.face === project.activeFace)) ??
      parts.blocks[0]
    if (!first) return null
    selectOnly(first.id)
    return first.id
  }

  /**
   * A new label is empty on every side and in every face. It is placed where the
   * pointer asked, the same on all of them — nothing has been measured about
   * any, so starting them apart would be inventing a difference.
   */
  function addLabelAt(x: number, y: number): string | null {
    const project = useProjectStore()
    if (!currentPageId.value) return null
    const parts = blankTranslation(project.header.seedStyle, project.faceIds, generateLabelId)
    for (const block of parts.blocks) {
      block.body.x = x
      block.body.y = y
    }
    return cmdAddLabel(currentPageId.value, parts)
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
      const block = project.blockById(pageId, id)
      if (block?.side !== 'source') continue
      before.set(id, block.body)
      after.set(id, {
        ...block.body,
        lines: linesOf(escapeText(filling.text)),
        from: filling.from,
        // ⚠️ Only the type, never the position. The block already stands where
        // it stands, and this is a correction to what it says.
        style: sourceStyle(block.body.style, filling, page),
      })
    }

    const born = verdict.spawns.map((spawn) => {
      const style = measuredStyle(seed, spawn)
      const read = sourceStyle(seed, spawn, page)
      const parts = blankTranslation(style, project.faceIds, generateLabelId)
      // Placed by where the reading was, which is the middle of the balloon.
      const source = anchorFor(read, spawn.centre)
      const translation = anchorFor(style, spawn.centre)
      for (const block of parts.blocks) {
        if (block.side === 'source') {
          block.body = {
            ...block.body,
            style: read,
            by: 'auto',
            lines: linesOf(escapeText(spawn.text)),
            from: spawn.from,
            x: source.x,
            y: source.y,
          }
        } else {
          block.body.x = translation.x
          block.body.y = translation.y
        }
      }
      return parts
    })

    cmdReshape(`recognize ${pageId}`, pageId, () => {
      for (const [id, source] of after) project.setLabelSource(pageId, id, source)
      for (const parts of born) project.addLabel(pageId, parts)
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
    // Only what this step moved goes back: a reading that was already set aside
    // stays where an earlier step put it.
    let moved: string[] = []
    pushCommand({
      label: `${aside ? 'set-aside' : 'take-back'} ${hashes.length}`,
      do: () => {
        moved = project.setReadingsAside(pageId, hashes, aside)
      },
      undo: () => {
        project.setReadingsAside(pageId, moved, !aside)
      },
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
    if (entry?.kind !== 'text' || entry.side !== 'source') return
    const was = entry.body
    const before: SourceBody = { ...was, lines: [...was.lines], style: { ...was.style } }
    if (before.from === reading.hash) return
    const after: SourceBody = {
      ...before,
      lines: linesOf(escapeText(reading.text)),
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
    const parts = blankTranslation(style, project.faceIds, generateLabelId)
    // Placed by its middle, as a run's own blocks are.
    const source = anchorFor(read, at)
    const translation = anchorFor(style, at)
    for (const block of parts.blocks) {
      if (block.side === 'source') {
        block.body = {
          ...block.body,
          style: read,
          by: 'auto',
          lines: linesOf(escapeText(reading.text)),
          from: reading.hash,
          x: source.x,
          y: source.y,
        }
      } else {
        block.body.x = translation.x
        block.body.y = translation.y
      }
    }
    cmdAddLabel(pageId, parts)
  }

  /** The selected text objects on the open page, locked ones refusing the whole step. */
  function selectedBlocksOnPage(): { pageId: string; ids: string[] } | null {
    const pageId = currentPageId.value
    const page = pageId === null ? undefined : useProjectStore().pageById(pageId)?.page
    if (!page || pageId === null) return null
    const ids = [...selectedIds.value].filter((id) => textOnPage(page, id))
    if (!ids.length || ids.some(isLayerLocked)) return null
    return { pageId, ids }
  }

  /**
   * A regrouping of the selection, worked out on a copy of the open page: the
   * structure it leaves, or null when it changes nothing. The blanks a
   * regrouping adds or removes live in that structure, so nothing it did can be
   * left behind by an undo.
   */
  function regrouped(change: (page: FacePage, ids: readonly string[]) => boolean) {
    const at = selectedBlocksOnPage()
    if (!at) return null
    commitTextEdit()
    const project = useProjectStore()
    const live = project.pageById(at.pageId)?.page
    if (!live) return null
    const draft = draftOf(live)
    if (!change(facePage(draft, project.activeFace), at.ids)) return null
    adoptSources(draft, project.faceIds, generateLabelId, project.header.seedStyle)
    numberPage(draft, project.faceIds)
    project.raiseCounters(at.pageId, draft.counters)
    const structure: PageStructure = {
      ledgers: draft.ledgers,
      readingOrder: draft.readingOrder,
      readingEdges: draft.readingEdges,
      ...snapshotTrees(draft),
    }
    const kept = [...selectedIds.value].filter((id) => textOnPage(draft, id))
    return { ...at, structure, kept }
  }

  function cmdRegroup(label: string, change: (page: FacePage, ids: readonly string[]) => boolean) {
    const project = useProjectStore()
    const done = regrouped(change)
    if (done === null) return
    const before = project.structureOf(done.pageId)!
    pushCommand({
      label: `${label} ${done.ids.length}`,
      detail: { page: done.pageId, ids: done.ids },
      do: () => project.setPageStructure(done.pageId, done.structure),
      undo: () => project.setPageStructure(done.pageId, before),
    })
    selectedIds.value = new Set(done.kept)
  }

  /**
   * With other faces the artwork's words are theirs too, so a regroup here
   * never takes them off the page.
   */
  function sharedSources(): boolean {
    return useProjectStore().faceIds.length > 1
  }

  const linkChange = (page: FacePage, ids: readonly string[]) =>
    relink(page, ids, generateLabelId, useProjectStore().header.seedStyle, sharedSources())

  /** Ctrl+E on text, and the menu's join. See `shared/page/relink`. */
  function cmdLinkSelection() {
    cmdRegroup('link', linkChange)
  }

  /**
   * The same, written straight onto the page for a step that is already open
   * there — Ctrl+E merging pixels in the same press. Answers the selected
   * blocks still on the page, or null when there was nothing to join.
   */
  function linkSelectionInPlace(): string[] | null {
    const done = regrouped(linkChange)
    if (done === null) return null
    useProjectStore().setPageStructure(done.pageId, done.structure)
    return done.kept
  }

  /** The menu's take-out; it has no key. */
  function cmdDetachSelection() {
    const seed = useProjectStore().header.seedStyle
    cmdRegroup('detach', (page, ids) => detach(page, ids, generateLabelId, seed, sharedSources()))
  }

  /** What Ctrl+E would do with the selected text right now, for showing while Ctrl is held. */
  function linkPlan(): RelinkPlan {
    const at = selectedBlocksOnPage()
    const view = at ? useProjectStore().viewOf(at.pageId) : undefined
    return at && view ? planRelink(view, at.ids) : { kind: 'none' }
  }

  function canDetachSelection(): boolean {
    const at = selectedBlocksOnPage()
    const view = at ? useProjectStore().viewOf(at.pageId) : undefined
    return at !== null && view !== undefined && canDetach(view, at.ids)
  }

  /**
   * A material put down on the page as a sentence of their own, the way a
   * reading is. What it gives lands on whichever side the canvas is showing,
   * because that is the side being worked on; the other side starts blank and
   * in the project's own style, as a reading's translation does. Placed by its
   * middle, where it was let go.
   */
  function materialParts(
    at: { x: number; y: number },
    gives: MaterialGives,
    side: TextSide,
  ): TranslationParts {
    const project = useProjectStore()
    const seed = project.header.seedStyle
    const style = { ...seed, ...gives.patch }
    const parts = blankTranslation(seed, project.faceIds, generateLabelId)
    for (const block of parts.blocks) {
      const own = block.side === side && (block.side === 'source' || block.face === project.activeFace)
      const anchor = anchorFor(own ? style : seed, at)
      block.body.x = anchor.x
      block.body.y = anchor.y
      if (!own) continue
      block.body.style = { ...style }
      if (gives.text !== null) block.body.lines = linesOf(escapeText(gives.text))
      if (gives.effects !== null) block.effects = cloneEffects(gives.effects)
    }
    return parts
  }

  /**
   * Several materials let go of in one gesture. One step, because what was let
   * go of was one armful — undoing it a sentence at a time would ask for as
   * many presses as the hand was carrying.
   */
  function cmdAddLabelsFromMaterial(
    pageId: string,
    drops: readonly { at: { x: number; y: number }; gives: MaterialGives }[],
    side: TextSide,
  ): string[] {
    const project = useProjectStore()
    if (drops.length === 0) return []
    const batch = drops.map((drop) => materialParts(drop.at, drop.gives, side))
    const made = batch.flatMap((parts) => {
      const first =
        parts.blocks.find((b) => b.side === side && (b.side === 'source' || b.face === project.activeFace)) ??
        parts.blocks[0]
      return first ? [first.id] : []
    })
    if (
      !cmdReshape(`add-labels ${batch.length}`, pageId, () => {
        for (const parts of batch) project.addLabel(pageId, parts)
      })
    )
      return []
    selectMany(made, false)
    return made
  }

  /** The objects as a reader meets them, so a group dragged stays a group. */
  function inChapterOrder(ids: readonly string[]): string[] {
    const project = useProjectStore()
    const wanted = new Set(ids)
    const out: string[] = []
    for (const file of project.files) {
      for (const id of project.viewOf(file.pageId)?.readingOrder ?? []) if (wanted.has(id)) out.push(id)
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
      const from = project.pageOfUnit(id) ?? project.pageOfEntry(id)
      if (from === null) continue
      touched.add(from)
      if (from !== page) incoming.push(id)
    }

    const before = new Map<string, string[]>()
    for (const p of touched) {
      before.set(p, [...(project.viewOf(p)?.readingOrder ?? [])])
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

    cmdReshapePages(`move-objects ${moving.length}`, [...touched], () => {
      const leaving = new Map<string, string[]>()
      for (const id of incoming) {
        const from = project.pageOfUnit(id)
        if (from !== null) leaving.set(from, [...(leaving.get(from) ?? []), id])
      }
      for (const [from, ids] of leaving) project.moveSentences(from, page, ids)
      for (const [p, order] of orders) {
        const now = project.viewOf(p)?.readingOrder ?? []
        // What the move brought along besides the dragged rows reads after them.
        project.setReadingOrder(p, [...order.filter((id) => now.includes(id)), ...now.filter((id) => !order.includes(id))])
      }
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
    const units = project.labelsOf(page)
    const atCursor =
      cursorId.value === null
        ? -1
        : units.findIndex((u) => u.id === project.placeOf(page, cursorId.value!)?.unit.id)
    if (atCursor >= 0) return atCursor

    const doomed = new Set<string>()
    for (const id of ids) {
      const entry = project.entryById(id)
      if (entry) for (const t of textObjects([entry])) doomed.add(project.placeOf(page, t.id)?.unit.id ?? '')
      else doomed.add(id)
    }
    const first = units.findIndex((u) => doomed.has(u.id))
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

    const pages = [...new Set(ids.flatMap((id) => project.pageOfEntry(id) ?? []))]
    cmdReshapePages(`delete-selection ${ids.length}`, pages, () => {
      for (const id of ids) project.removeEntry(id)
    })

    if (page === null) {
      selectOnly(null)
      return
    }
    const left = project.labelsOf(page)
    const landed = left[Math.min(landing, left.length - 1)]
    const view = project.viewOf(page)
    // The cursor stands on a block, so the translation that took the place is
    // resolved back down to the one being shown.
    const block = landed === undefined || view === undefined ? undefined : blocksOf(view, landed, textSide.value)[0]
    selectOnly(block?.id ?? null)
  }


  
  function cmdMoveLabel(
    pageId: string,
    labelId: string,
    oldPos: { x: number; y: number },
    newPos: { x: number; y: number },
  ) {
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    pushCommand(
      {
        label: `move-label ${labelId}`,
        do: () => project.moveLabel(pageId, labelId, newPos.x, newPos.y),
        undo: () => project.moveLabel(pageId, labelId, oldPos.x, oldPos.y),
      },
      { alreadyApplied: true },
    )
  }


  /**
   * The arrow keys' move: every selected object on the page, text and raster
   * alike, by whole page pixels. Locked ones stay where they are.
   *
   * ⭐ A run of presses is one step, as in Photoshop. A press that follows the
   * last one on the same objects, with nothing taken onto the history between,
   * adds its travel to the step already there instead of stacking another —
   * so ten presses and one undo puts the objects back where the run began.
   */
  let lastNudge: { key: string; cmd: Command; total: { x: number; y: number } } | null = null

  function cmdNudge(dx: number, dy: number) {
    const page = currentPageId.value
    if (page === null) return
    const project = useProjectStore()
    const ids = [...selectedIds.value]
      .filter((id) => !isLayerLocked(id) && project.pageOfEntry(id) === page)
      .sort()
    if (ids.length === 0) return

    const shift = (by: { x: number; y: number }) => {
      for (const id of ids) {
        const entry = project.entryById(id)
        if (entry?.kind === 'text') {
          project.moveLabel(page, id, entry.body.x + by.x, entry.body.y + by.y)
        } else if (entry?.kind === 'raster' && entry.w > 0) {
          project.placeLayer(page, id, { ...entry, x: entry.x + by.x, y: entry.y + by.y })
        }
      }
    }

    const key = `${page}|${ids.join(',')}`
    const top = historyOf(currentBook.value).undo.at(-1)
    if (lastNudge !== null && lastNudge.key === key && top === lastNudge.cmd) {
      shift({ x: dx, y: dy })
      lastNudge.total.x += dx
      lastNudge.total.y += dy
      return
    }

    const total = { x: dx, y: dy }
    const cmd: Command = {
      label: `nudge ${ids.length}`,
      detail: { ids, dx, dy },
      do: () => shift(total),
      undo: () => shift({ x: -total.x, y: -total.y }),
    }
    if (!pushCommand(cmd)) return
    lastNudge = { key, cmd, total }
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
    from: TurnedLabel,
    to: TurnedLabel,
  ) {
    if (JSON.stringify(from) === JSON.stringify(to) || isLayerLocked(labelId)) return
    const project = useProjectStore()
    const apply = (state: TurnedLabel) => {
      project.rotateLabel(pageId, labelId, state.rotation)
      project.moveLabel(pageId, labelId, state.x, state.y)
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
    from: ScaledLabel,
    to: ScaledLabel,
  ) {
    if (JSON.stringify(from) === JSON.stringify(to)) return
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const apply = (state: ScaledLabel) => {
      project.setLabelStyle(pageId, labelId, state.style)
      project.flipLabel(pageId, labelId, { x: state.flipX, y: state.flipY })
      project.moveLabel(pageId, labelId, state.x, state.y)
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
   * One gesture, as one step however many objects it carried: the text a
   * multiple selection moved and the raster layers it moved with them.
   *
   * The labels' after is already written — the gesture drew with it — and
   * writing it again is harmless; a raster layer's arrives here whole, a new
   * frame and often a new file, and undo puts the old name back, which is still
   * on disk until orphans are swept. A label that came back to where it began
   * leaves nothing, and a member locked since is stepped over rather than
   * taking the rest down.
   */
  function cmdPlaceObjects(
    pageId: string,
    moves: {
      labels?: { from: ReadonlyMap<string, PlacedLabel>; to: ReadonlyMap<string, PlacedLabel> }
      layers?: readonly { id: string; from: LayerPlace; to: LayerPlace }[]
    },
  ) {
    const labels = moves.labels
    const labelIds = labels
      ? [...labels.to.keys()].filter(
          (id) => labels.from.has(id) && JSON.stringify(labels.from.get(id)) !== JSON.stringify(labels.to.get(id)),
        )
      : []
    const layers = (moves.layers ?? []).filter((m) => !isLayerLocked(m.id))
    if (labelIds.length === 0 && layers.length === 0) return
    const project = useProjectStore()
    const apply = (side: 'from' | 'to') => {
      for (const id of labelIds) {
        if (isLayerLocked(id)) continue
        const state = labels?.[side].get(id)
        if (!state) continue
        project.setLabelStyle(pageId, id, state.style)
        project.rotateLabel(pageId, id, state.rotation)
        project.flipLabel(pageId, id, { x: state.flipX, y: state.flipY })
        project.moveLabel(pageId, id, state.x, state.y)
      }
      for (const move of layers) {
        if (!isLayerLocked(move.id)) project.placeLayer(pageId, move.id, move[side])
      }
    }
    pushCommand({
      label: `place ${labelIds.length + layers.length}`,
      do: () => apply('to'),
      undo: () => apply('from'),
    })
  }

  /**
   * A blank layer arrives with no frame at all. The first write places one and
   * later writes that reach past it grow it — an AI erase patch extended by
   * hand has to grow the same way, so nothing here is owed to this button alone.
   */
  function cmdAddRasterLayer(pageId: string, layer: RasterLayerEntry, path?: number[]) {
    const project = useProjectStore()
    cmdReshape(`add-layer ${layer.id}`, pageId, () => project.addLayer(pageId, layerHome(), layer, path))
    selectOnly(layer.id)
  }

  function newFolder(name: string): GroupLayerEntry {
    return {
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
  }

  function cmdAddFolder(pageId: string, name: string) {
    const project = useProjectStore()
    const home = layerHome()
    if (home === null) {
      useNoticeStore().say('原文模式就是 page 本身，page 不放資料夾')
      return
    }
    const folder = newFolder(name)
    let path: number[] | undefined
    pushCommand({
      label: `add-folder ${folder.id}`,
      do: () => project.addLayer(pageId, home, folder, path),
      undo: () => {
        const removed = project.dissolveFolder(pageId, folder.id)
        path = removed?.path
      },
    })
  }

  /**
   * Ctrl+G: the selection gathered into a new folder on each page it reaches,
   * where the topmost of it stood. A selection spans pages and a folder cannot,
   * so every page gets its own, all in one step.
   */
  function cmdGroupSelection() {
    const project = useProjectStore()
    const home = layerHome()
    if (home === null) {
      useNoticeStore().say('原文模式就是 page 本身，page 不放資料夾')
      return
    }
    const byPage = new Map<string, Set<string>>()
    let skipped = false
    for (const id of selectedIds.value) {
      const pageId = project.pageOfEntry(id)
      const file = pageId === null ? undefined : project.pageById(pageId)
      if (!file || pathOf(treeOf(file.page, textSide.value, project.activeFace), id) === null) continue
      if (isLayerLocked(id)) {
        skipped = true
        continue
      }
      const ids = byPage.get(file.pageId) ?? new Set<string>()
      ids.add(id)
      byPage.set(file.pageId, ids)
    }
    if (skipped) useNoticeStore().say('鎖定的圖層沒有放進資料夾')
    if (byPage.size === 0) return
    const folders = new Map(
      [...byPage.keys()].map((pageId) => {
        const page = project.pageById(pageId)!.page
        const taken = new Set(everyEntry(page).flatMap((e) => (e.kind === 'group' ? [e.name] : [])))
        return [pageId, newFolder(nextAutoName(taken, '資料夾'))] as const
      }),
    )
    const pages = [...byPage.keys()]
    const done = cmdReshapePages(`group ${pages.length}`, pages, () => {
      let changed = false
      for (const [pageId, ids] of byPage) changed = project.groupLayers(pageId, home, ids, folders.get(pageId)!) || changed
      return changed
    })
    if (!done) return
    const here = currentPageId.value === null ? undefined : folders.get(currentPageId.value)
    const lead = (here ?? folders.values().next().value!).id
    selectedIds.value = new Set([...folders.values()].map((f) => f.id))
    cursorId.value = lead
    anchorId.value = lead
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
        undo: () => project.restoreFolder(pageId, removed.home, removed.path, removed.folder),
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
    const home = layerHome()
    const into = file ? folderAtPath(treeOf(file.page, textSide.value, project.activeFace), target.parentPath) : null
    if (into !== null && isLayerLocked(into.id)) return
    if (!project.moveLayer(pageId, home, fromPath, target)) return
    pushCommand(
      {
        label: `move-layer ${layerId}`,
        do: () => project.moveLayer(pageId, home, fromPath, target),
        undo: () => project.restoreLayerAt(pageId, home, layerId, fromPath),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * The layer order menu: what is selected on the page moves within its own
   * folder, past the siblings the layer panel lists, as one step however many
   * folders it touches.
   */
  function cmdRestack(pageId: string, ids: readonly string[], how: Restack) {
    const project = useProjectStore()
    const file = project.pageById(pageId)
    if (!file) return
    const tree = () => treeOf(file.page, textSide.value, project.activeFace)
    const movable = ids.filter((id) => !isLayerLocked(id))
    if (movable.length < ids.length) useNoticeStore().say('鎖定的圖層沒有移動')
    const folders = new Map<string, { parentPath: number[]; ids: Set<string> }>()
    for (const id of movable) {
      const path = pathOf(tree(), id)
      if (path === null) continue
      const parentPath = path.slice(0, -1)
      const key = parentPath.join('/')
      const folder = folders.get(key) ?? { parentPath, ids: new Set<string>() }
      folder.ids.add(id)
      folders.set(key, folder)
    }
    if (folders.size === 0) return
    const childrenOf = (parentPath: number[]) =>
      parentPath.length === 0 ? tree() : (folderAtPath(tree(), parentPath)?.children ?? [])
    cmdReshape(`restack-${how} ${movable.length}`, pageId, () => {
      let changed = false
      for (const { parentPath, ids: picked } of folders.values()) {
        const siblings = childrenOf(parentPath)
        const order = restackOrder(
          siblings.map((entry) => ({
            selected: picked.has(entry.id),
            shown: entry.kind !== 'text' || isOnView(entry, textSide.value, project.activeFace),
          })),
          how,
        )
        const wanted = order.map((i) => siblings[i]!.id)
        for (const [to, id] of wanted.entries()) {
          const from = childrenOf(parentPath).findIndex((entry) => entry.id === id)
          if (from === to) continue
          project.moveLayer(pageId, layerHome(), [...parentPath, from], { parentPath, index: to })
          changed = true
        }
      }
      return changed
    })
  }

  /** The same, on what is selected on the page being shown. */
  function cmdRestackSelection(how: Restack) {
    const page = currentPageId.value
    if (page === null) return
    const project = useProjectStore()
    cmdRestack(page, [...selectedIds.value].filter((id) => project.pageOfEntry(id) === page), how)
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
    return file ? isLocked(treeOf(file.page, textSide.value, project.activeFace), id) : false
  }

  /**
   * A raster put on every face or taken back into the one being worked on: the
   * page's to give and the page's to take, and from the source side there is no
   * face to take it into.
   */
  function cmdSetLayerLinked(pageId: string, layerId: string, linked: boolean) {
    const project = useProjectStore()
    const face = layerHome()
    if (face === null) {
      useNoticeStore().say('原文模式就是 page 本身，沒有可以拿回去的 face')
      return
    }
    cmdReshape(`${linked ? 'link' : 'unlink'}-layer ${layerId}`, pageId, () =>
      project.setLayerLinked(pageId, face, layerId, linked),
    )
  }

  /**
   * Which tree something new lands in: the face being worked on, or the page's
   * own (`null`) on the source side, which is the page.
   */
  function layerHome(): string | null {
    return textSide.value === 'source' ? null : useProjectStore().activeFace
  }

  /** The tree a page is worked in now: the page's own on the source side, the face's on the translation side. */
  function workingTree(pageId: string): readonly LayerEntry[] {
    const project = useProjectStore()
    const file = project.pageById(pageId)
    return file ? treeOf(file.page, textSide.value, project.activeFace) : []
  }

  /**
   * A reading line joins translations and a lock is put on lettering, so a
   * translation is held still when any block of it on the side being worked on
   * is.
   */
  function isUnitLocked(pageId: string, unitId: string): boolean {
    const project = useProjectStore()
    const unit = project.unitById(pageId, unitId)
    const view = project.viewOf(pageId)
    if (unit === undefined || view === undefined) return false
    return blocksOf(view, unit, textSide.value).some((block) => isLayerLocked(block.id))
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
   * The working copy set to one opacity across these pages, lock or no lock:
   * a lock is put on against a stray drag, and this is asked for by name.
   * Left out of history when the caller says so, since it is flipped back and
   * forth while lettering and each flip would otherwise stand between the
   * hand and the last real edit.
   *
   * Answers what each layer it changed held before, so a hold can put exactly
   * that back.
   */
  function cmdSetRetouchOpacity(
    pageIds: readonly string[],
    opacity: number,
    opts: { undoable: boolean },
  ): { pageId: string; id: string; opacity: number }[] {
    const project = useProjectStore()
    const names = new Set(project.retouchLayerNames)
    const moved: { pageId: string; id: string; opacity: number }[] = []
    for (const pageId of pageIds) {
      const file = project.pageById(pageId)
      if (!file) continue
      for (const entry of everyEntry(file.page)) {
        if (entry.kind !== 'raster' || !names.has(entry.name) || entry.opacity === opacity) continue
        moved.push({ pageId, id: entry.id, opacity: entry.opacity })
      }
    }
    if (moved.length === 0) return moved
    for (const { pageId, id } of moved) project.setLayerOpacity(pageId, id, opacity)
    if (!opts.undoable) return moved
    pushCommand(
      {
        label: `set-retouch-opacity ${moved.length}`,
        do: () => {
          for (const { pageId, id } of moved) project.setLayerOpacity(pageId, id, opacity)
        },
        undo: () => {
          for (const { pageId, id, opacity: was } of moved) project.setLayerOpacity(pageId, id, was)
        },
      },
      { alreadyApplied: true },
    )
    return moved
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
    oldText: string,
    newText: string,
    wasTheirs?: boolean,
  ) {
    if (oldText === newText || isLayerLocked(labelId)) return
    const project = useProjectStore()
    const held = chosenCandidate(pageId, labelId)
    // ⚠️ Read now only for a caller that has not written anything through yet.
    // An editing session has, and stamped as it went, so it carries the answer
    // from before the first keystroke.
    const was = wasTheirs ?? held?.human === true
    pushCommand({
      label: `update-text ${labelId}`,
      detail: { page: pageId, id: labelId, from: oldText, to: newText },
      do: () => project.updateLabelText(pageId, labelId, newText),
      undo: () => {
        project.updateLabelText(pageId, labelId, oldText)
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

  /** The proposal a block of lettering is reading, when it is reading one. */
  function chosenCandidate(pageId: string, blockId: string): TranslationCandidate | null {
    const block = useProjectStore().blockById(pageId, blockId)
    return block?.side === 'translation' ? chosenCandidateOf(block) : null
  }

  function letteringOf(pageId: string, blockId: string): TranslationTextLayerEntry | undefined {
    const block = useProjectStore().blockById(pageId, blockId)
    return block?.side === 'translation' ? block : undefined
  }

  /**
   * Which line a block reads as. `null` is the lines it was typed with.
   *
   * ⚠️ On the stack, unlike the panel this replaces, which wrote straight
   * through. Picking is the decision the whole list exists to make, and a Ctrl+Z
   * that skipped past it to take back the sentence before would be undoing the
   * wrong thing at the one moment somebody is sure what they just did.
   */
  function cmdPickTranslation(pageId: string, labelId: string, id: string | null) {
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const block = letteringOf(pageId, labelId)
    if (!block) return
    const was = block.body.chosen
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
    const block = letteringOf(pageId, labelId)
    if (!block) return
    const at = block.body.candidates.length
    const was = block.body.chosen
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
   * ⭐ Deleting the one being read drops the block back to its own typed lines
   * rather than to another proposal. What those lines are is the last thing
   * anybody chose for themselves; picking the next proposal along would be the
   * program making a choice out of the deletion, which said nothing about it.
   */
  function cmdRemoveTranslation(pageId: string, labelId: string, id: string) {
    if (isLayerLocked(labelId)) return
    const project = useProjectStore()
    const block = letteringOf(pageId, labelId)
    const at = block?.body.candidates.findIndex((c) => c.id === id) ?? -1
    if (!block || at === -1) return
    const was = { ...block.body.candidates[at]!, lines: [...block.body.candidates[at]!.lines] }
    const chosen = block.body.chosen
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
  /**
   * The selection as the side on screen reaches it. A text block selected on
   * the other side stands for its sentence's blocks on this one: the selection
   * outlives Shift+S so Ctrl+E can pair across the two sides, and a person who
   * picked translations on the shelf and turned to the sources means to change
   * those sources, not the translations they can no longer see.
   *
   * ⚠️ Ctrl+E and every move read the selection itself, never this.
   */
  const reachedIds = computed<ReadonlySet<string>>(() => {
    const project = useProjectStore()
    const side = textSide.value
    const out = new Set<string>()
    for (const id of selectedIds.value) {
      const entry = project.entryById(id)
      const pageId = project.pageOfEntry(id)
      if (entry?.kind !== 'text' || entry.side === side || pageId === null) {
        out.add(id)
        continue
      }
      const unit = project.placeOf(pageId, id)?.unit
      const view = project.viewOf(pageId)
      if (unit && view) for (const block of blocksOf(view, unit, side)) out.add(block.id)
    }
    return out
  })

  /** Whether a change to the selection's appearance reaches this node. */
  function isReached(id: string): boolean {
    return reachedIds.value.has(id)
  }

  function selectedNodes(): AppearanceTarget<LayerEntry>[] {
    const project = useProjectStore()
    const out: AppearanceTarget<LayerEntry>[] = []
    for (const id of [...reachedIds.value].filter((id) => !isLayerLocked(id))) {
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

  type StyleState = { pageId: string; id: string; style: TextStyle }[]

  function stylesOf(targets: readonly AppearanceTarget<TextLayerEntry>[]): StyleState {
    return targets.map(({ pageId, entry }) => ({ pageId, id: entry.id, style: { ...entry.body.style } }))
  }

  function sameNodes(state: readonly { id: string }[], targets: readonly AppearanceTarget[]): boolean {
    return state.length === targets.length && state.every((s, at) => s.id === targets[at]!.entry.id)
  }

  /** What the objects held before a gesture started previewing, until it commits. */
  let stylePreviewedFrom: StyleState | null = null

  function writeStyles(states: StyleState) {
    const project = useProjectStore()
    for (const { pageId, id, style } of states) project.setLabelStyle(pageId, id, style)
  }

  /**
   * The same arrangement as `previewEffects`, for a text object's style. A
   * preview belongs to the objects it started on: reaching others first puts
   * those back.
   */
  function previewStyle(targets: readonly AppearanceTarget<TextLayerEntry>[], patch: Partial<TextStyle>) {
    if (stylePreviewedFrom !== null && !sameNodes(stylePreviewedFrom, targets)) {
      writeStyles(stylePreviewedFrom)
      stylePreviewedFrom = null
    }
    stylePreviewedFrom ??= stylesOf(targets)
    logActivity('preview', { n: targets.length, patch })
    writeStyles(stylePreviewedFrom.map((s) => ({ ...s, style: { ...s.style, ...patch } })))
  }

  /** A style preview let go of without committing: the objects get back what they held. */
  function endStylePreview() {
    if (stylePreviewedFrom === null) return
    writeStyles(stylePreviewedFrom)
    stylePreviewedFrom = null
  }

  /**
   * One act, however many objects it touched. Undoing a batch has to put every
   * one of them back at once — anything else would leave the selection half
   * changed, which is a state the user never asked for and cannot see.
   */
  function cmdApplyStyle(
    targets: readonly AppearanceTarget<TextLayerEntry>[],
    patch: Partial<TextStyle>,
  ) {
    const previewed = stylePreviewedFrom
    stylePreviewedFrom = null
    if (previewed !== null && !sameNodes(previewed, targets)) writeStyles(previewed)
    if (targets.length === 0 || Object.keys(patch).length === 0) return
    const before =
      previewed !== null && sameNodes(previewed, targets) ? previewed : stylesOf(targets)
    const after = before.map((entry) => ({ ...entry, style: { ...entry.style, ...patch } }))
    if (JSON.stringify(before) === JSON.stringify(after)) return
    pushCommand({
      label: `style ${targets.length}`,
      detail: { ids: targets.map((t) => t.entry.id), patch },
      do: () => writeStyles(after),
      undo: () => writeStyles(before),
    })
  }

  type EffectsState = { pageId: string; id: string; effects: LayerEffect[] }[]

  function effectsOf(targets: readonly AppearanceTarget[]): EffectsState {
    return targets.map(({ pageId, entry }) => ({
      pageId,
      id: entry.id,
      effects: cloneEffects(entry.effects),
    }))
  }

  /** What the nodes held before a gesture started previewing, until it commits. */
  let previewedFrom: EffectsState | null = null

  function writeEffects(states: EffectsState) {
    const project = useProjectStore()
    for (const { pageId, id, effects: value } of states)
      project.setLayerEffects(pageId, id, cloneEffects(value))
  }

  /**
   * Writes straight through, outside history, while a gesture is still moving —
   * the commit that ends it is the one step undo sees, back to where it began.
   * A preview belongs to the nodes it started on: reaching others first puts
   * those back.
   */
  function previewEffects(targets: readonly AppearanceTarget[], effects: readonly LayerEffect[]) {
    if (previewedFrom !== null && !sameNodes(previewedFrom, targets)) {
      writeEffects(previewedFrom)
      previewedFrom = null
    }
    previewedFrom ??= effectsOf(targets)
    writeEffects(previewedFrom.map((s) => ({ ...s, effects: [...effects] })))
  }

  /** A preview let go of without committing: the nodes get back what they held. */
  function endEffectsPreview() {
    if (previewedFrom === null) return
    writeEffects(previewedFrom)
    previewedFrom = null
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
    const previewed = previewedFrom
    previewedFrom = null
    if (previewed !== null && !sameNodes(previewed, targets)) writeEffects(previewed)
    if (targets.length === 0) return
    const before =
      previewed !== null && sameNodes(previewed, targets) ? previewed : effectsOf(targets)
    const after = before.map((entry) => ({ ...entry, effects: cloneEffects(effects) }))
    if (JSON.stringify(before) === JSON.stringify(after)) return
    pushCommand({
      label: `effects ${targets.length}`,
      do: () => writeEffects(after),
      undo: () => writeEffects(before),
    })
  }

  /**
   * A saved look given in one act. Its style and its effects land together and
   * leave together: an undo that took back the font and kept the stroke would
   * leave a look nobody saved. Whatever was being tried is put back first, so
   * the before is what the objects held and not the trial. A null stroke leaves
   * each object's own.
   */
  function cmdApplyLook(
    targets: readonly AppearanceTarget<TextLayerEntry>[],
    patch: Partial<TextStyle>,
    effects: readonly LayerEffect[] | null,
  ) {
    endStylePreview()
    endEffectsPreview()
    if (targets.length === 0) return
    const stylesBefore = stylesOf(targets)
    const stylesAfter = stylesBefore.map((entry) => ({ ...entry, style: { ...entry.style, ...patch } }))
    const effectsBefore = effectsOf(targets)
    const effectsAfter = effectsBefore.map((entry) => ({
      ...entry,
      effects: cloneEffects(effects ?? entry.effects),
    }))
    if (
      JSON.stringify(stylesBefore) === JSON.stringify(stylesAfter) &&
      JSON.stringify(effectsBefore) === JSON.stringify(effectsAfter)
    )
      return
    pushCommand({
      label: `apply-look ${targets.length}`,
      detail: { ids: targets.map((t) => t.entry.id), patch },
      do: () => {
        writeStyles(stylesAfter)
        writeEffects(effectsAfter)
      },
      undo: () => {
        writeStyles(stylesBefore)
        writeEffects(effectsBefore)
      },
    })
  }

  /**
   * Strokes tried on each object over its own effects, rather than one list
   * written to them all: what is being offered is strokes, and an object's
   * shadow is none of their business.
   */
  function previewStrokes(targets: readonly AppearanceTarget[], strokes: readonly StrokeEffect[]) {
    if (previewedFrom !== null && !sameNodes(previewedFrom, targets)) {
      writeEffects(previewedFrom)
      previewedFrom = null
    }
    previewedFrom ??= effectsOf(targets)
    writeEffects(previewedFrom.map((s) => ({ ...s, effects: withStrokes(s.effects, strokes) })))
  }

  /**
   * Part of one object's look lent to others: the style fields in `patch`, and
   * its strokes. Each keeps the rest of what it carries — only its strokes are
   * replaced, or taken away where the lender has none — and it all lands in a
   * single step, since what was asked for was one look.
   */
  function cmdApplyLentLook(
    targets: readonly AppearanceTarget<TextLayerEntry>[],
    patch: Partial<TextStyle>,
    strokes: readonly StrokeEffect[],
  ) {
    endStylePreview()
    endEffectsPreview()
    if (targets.length === 0) return
    const stylesBefore = stylesOf(targets)
    const stylesAfter = stylesBefore.map((entry) => ({ ...entry, style: { ...entry.style, ...patch } }))
    const effectsBefore = effectsOf(targets)
    const effectsAfter = effectsBefore.map((entry) => ({
      ...entry,
      effects: withStrokes(entry.effects, strokes.map((stroke) => ({ ...stroke }))),
    }))
    if (
      JSON.stringify(stylesBefore) === JSON.stringify(stylesAfter) &&
      JSON.stringify(effectsBefore) === JSON.stringify(effectsAfter)
    )
      return
    pushCommand({
      label: `apply-lent-look ${targets.length}`,
      detail: { ids: targets.map((t) => t.entry.id), patch },
      do: () => {
        writeStyles(stylesAfter)
        writeEffects(effectsAfter)
      },
      undo: () => {
        writeStyles(stylesBefore)
        writeEffects(effectsBefore)
      },
    })
  }

  /**
   * The order the blocks of one side are read in, as a step of history.
   *
   * ⭐ On the stack rather than written straight through, unlike a restack in
   * the layer tree: this changes what the translation says. Dragging 「隆」 above
   * 「轟」 makes the page read 隆轟, and an edit to the words is exactly what a
   * Ctrl+Z is expected to reach.
   */
  function cmdReorderMembers(
    pageId: string,
    unitId: string,
    side: TextSide,
    members: readonly string[],
  ) {
    const project = useProjectStore()
    const unit = project.unitById(pageId, unitId)
    if (!unit) return
    const was = unit.members.filter((id) => project.blockById(pageId, id)?.side === side)
    const face = project.activeFace
    if (was.length === members.length && was.every((id, at) => id === members[at])) return
    const wanted = [...members]
    pushCommand({
      label: `reorder-members ${unitId}`,
      do: () => project.reorderMembers(pageId, unitId, side, wanted, face),
      undo: () => project.reorderMembers(pageId, unitId, side, was, face),
    })
  }

  /**
   * A gesture's worth of lines, however many it drew — connecting five objects
   * in one sweep is one thing that happened, and five entries to undo would say
   * it was five.
   *
   * Applied first, like a restack: the lines a page refuses — a ring, or one
   * already drawn — must not reach the stack as an entry that undoes to
   * nothing. What is recorded is the artwork's lines the page actually took,
   * so taking the gesture back cannot rub out a line that was there before it,
   * and is the same whichever face is being looked at by then.
   */
  function cmdDrawReadingEdges(pageId: string, edges: readonly ReadingEdge[]) {
    const project = useProjectStore()
    // Where an object is read is one of the things a lock is put on to hold
    // still, and a line is a statement about exactly that.
    const allowed = edges.filter((e) => !isUnitLocked(pageId, e.from) && !isUnitLocked(pageId, e.to))
    const taken = project.addReadingEdges(pageId, allowed)
    if (taken.length === 0) return
    pushCommand(
      {
        label: `draw-reading-edges ${taken.length}`,
        do: () => project.addSourceEdges(pageId, taken),
        undo: () => project.removeSourceEdges(pageId, taken),
      },
      { alreadyApplied: true },
    )
  }

  function cmdEraseReadingEdges(pageId: string, edges: readonly ReadingEdge[]) {
    const project = useProjectStore()
    const held = project.readingEdgesOf(pageId)
    const going = edges.filter(
      (e) => hasEdge(held, e) && !isUnitLocked(pageId, e.from) && !isUnitLocked(pageId, e.to),
    )
    if (going.length === 0) return
    let taken: ReadingEdge[] = []
    pushCommand({
      label: `erase-reading-edges ${going.length}`,
      do: () => {
        taken = project.removeReadingEdges(pageId, going)
      },
      undo: () => project.addSourceEdges(pageId, taken),
    })
  }

  /**
   * A face added or taken away, as one step: every page's structure and the
   * face list before and after, whole. Running the work again on redo would
   * mint new ids for what the steps above it already name.
   */
  function cmdFaces(label: string, change: () => boolean) {
    const project = useProjectStore()
    let before: FaceState | undefined
    let after: FaceState | undefined
    pushCommand({
      label,
      do: () => {
        if (after !== undefined) return project.setFaceState(after)
        before = project.faceState()
        if (!change()) return false
        after = project.faceState()
      },
      undo: () => {
        if (before !== undefined) project.setFaceState(before)
      },
    })
    selectedIds.value = new Set([...selectedIds.value].filter((id) => project.entryById(id) !== undefined))
  }

  /** A new face lettered like the one being worked on, which it then becomes. */
  function cmdAddFace(name: string) {
    const project = useProjectStore()
    cmdFaces(`add-face ${name}`, () => {
      project.setActiveFace(project.addFace(name))
      return true
    })
  }

  function cmdDeleteFace(id: string) {
    const project = useProjectStore()
    cmdFaces(`delete-face ${id}`, () => project.deleteFace(id))
  }

  function cmdRenameFace(id: string, name: string) {
    const project = useProjectStore()
    const was = project.faces.find((f) => f.id === id)?.name
    if (was === undefined || was === name) return
    pushCommand({
      label: `rename-face ${id}`,
      do: () => project.renameFace(id, name),
      undo: () => project.renameFace(id, was),
    })
  }

  /**
   * Which face the canvas letters in. Not a step of history: it changes what is
   * looked at, the way turning a page does.
   */
  function setActiveFace(id: string) {
    commitTextEdit()
    const project = useProjectStore()
    project.setActiveFace(id)
    // Lettering of another face is nowhere on screen now, and acting on it
    // would act on what nobody can see.
    const kept = [...selectedIds.value].filter((sel) => {
      const entry = project.entryById(sel)
      return entry?.kind !== 'text' || entry.side === 'source' || entry.face === id
    })
    if (kept.length !== selectedIds.value.size) selectMany(kept, false)
  }

  /** The tags each block of a sentence's artwork carries now, which is what undoing a tag write puts back. */
  function sourceTagsOf(pageId: string, unitId: string): Array<{ pageId: string; id: string; tags: string[] }> {
    const project = useProjectStore()
    const unit = project.unitById(pageId, unitId)
    const view = project.viewOf(pageId)
    if (!unit || !view) return []
    return sourceBlocksOf(view, unit).map((b) => ({ pageId, id: b.id, tags: [...b.body.tags] }))
  }

  /** The sentences these blocks belong to in the face being worked on, each once. */
  function sentencesOf(ids: Iterable<string>): Array<{ pageId: string; unitId: string }> {
    const project = useProjectStore()
    const out = new Map<string, { pageId: string; unitId: string }>()
    for (const id of ids) {
      const pageId = project.pageOfEntry(id)
      const unit = pageId === null ? undefined : project.placeOf(pageId, id)?.unit
      if (pageId !== null && unit !== undefined) out.set(`${pageId}\u0000${unit.id}`, { pageId, unitId: unit.id })
    }
    return [...out.values()]
  }

  /** Puts one tag on these sentences or takes it off them, leaving their other tags be; one undo step. */
  function cmdTagSentences(targets: readonly { pageId: string; unitId: string }[], tag: string, on: boolean) {
    const project = useProjectStore()
    const face = project.activeFace
    const changes = targets.flatMap(({ pageId, unitId }) => {
      const unit = project.unitById(pageId, unitId)
      const view = project.viewOf(pageId)
      if (!unit || !view || unit.members.some(isLayerLocked)) return []
      const now = tagsOfUnit(view, unit)
      const next = on ? withTag(now, tag) : withoutTag(now, tag)
      return sameTagSet(now, next) ? [] : [{ pageId, unitId, next, was: sourceTagsOf(pageId, unitId) }]
    })
    if (changes.length === 0) return
    pushCommand({
      label: `${on ? 'tag' : 'untag'} ${tag} ×${changes.length}`,
      do: () => {
        for (const c of changes) project.setLabelTags(c.pageId, c.unitId, c.next, face)
      },
      undo: () => {
        for (const b of changes.flatMap((c) => c.was)) project.setSourceTags(b.pageId, b.id, b.tags)
      },
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
    textsHidden,
    showingOriginal,
    tagsShown,
    foreground,
    fontSize,
    adjustFontSize,
    view,
    viewContainerSize,
    viewContentSize,
    viewFittedPage,
    maskTarget,
    fitToView,
    viewFitArea,
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
    chapterRows,
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
    historyStep,
    historyMark,
    foldSince,
    forgetJournals,
    undo,
    redo,
    clearHistory,
    closeBook,
    cmdSetPageOrder,
    cmdImportPages,
    addLabelAt,
    deleteSelection,
    moveObjectsTo,
    cmdAddLabel,
    cmdApplyVerdict,
    cmdSetReadingsAside,
    cmdAddLabelFromReading,
    cmdAddLabelsFromMaterial,
    cmdLinkSelection,
    isReached,
    cmdDetachSelection,
    linkSelectionInPlace,
    canDetachSelection,
    linkPlan,
    cmdReplaceLabelSource,
    cmdMoveCard,
    cmdMoveLabel,
    cmdPlaceObjects,
    cmdNudge,
    cmdRotateLabel,
    cmdScaleLabel,
    cmdAddRasterLayer,
    cmdAddFolder,
    cmdGroupSelection,
    cmdDissolveFolder,
    cmdMoveLayer,
    cmdRestack,
    cmdRestackSelection,
    cmdSetLayerVisible,
    cmdSetLayerLocked,
    cmdSetLayerAlphaLocked,
    isLayerLocked,
    layerHome,
    cmdSetLayerLinked,
    workingTree,
    isUnitLocked,
    cmdRenameLayer,
    cmdSetOpacity,
    cmdSetRetouchOpacity,
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
    previewStyle,
    endStylePreview,
    cmdApplyEffects,
    cmdApplyLook,
    previewEffects,
    endEffectsPreview,
    previewStrokes,
    cmdApplyLentLook,
    cmdReorderMembers,
    cmdDrawReadingEdges,
    cmdEraseReadingEdges,
    sentencesOf,
    cmdTagSentences,
    cmdReshape,
    cmdAddFace,
    cmdDeleteFace,
    cmdRenameFace,
    setActiveFace,
    cmdAddTag,
    cmdMovePage,
    cmdDeletePages,
  }
})
