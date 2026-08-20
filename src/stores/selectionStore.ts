import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { useEditorStore } from '@/stores/editorStore'
import {
  DEFAULT_BRUSH_HARDNESS,
  DEFAULT_BRUSH_SIZE,
  MAX_BRUSH_SIZE,
  MIN_BRUSH_SIZE,
  strokeMask,
  type MaskBrushMode,
} from '@/lib/selection/brushMask'
import {
  boundsOfWindow,
  composeWindow,
  normalizeOp,
  regionFor,
  type MaskTarget,
  type MaskWindow,
  type SelectionOp,
} from '@/lib/selection/mask'
import { marqueeRect } from '@/lib/selection/marquee'
import {
  rasterizeEllipse,
  rasterizePolygon,
  rasterizeRect,
  type ShapeRaster,
} from '@/lib/selection/raster'
import {
  clampToPage,
  EMPTY_RECT,
  isEmptyRect,
  unionRect,
  type Point,
  type Rect,
} from '@/lib/selection/rect'
import { traceMaskOutlines } from '@/lib/selection/trace'

export type { MaskTarget }

/** What a hand-drawn stroke is shaped by. Diameter in page pixels. */
export interface BrushSettings {
  size: number
  hardness: number
}

export type SelectionGestureKind = 'marquee-rect' | 'marquee-ellipse' | 'lasso' | 'lasso-polygon'

export interface SelectionGesture {
  kind: SelectionGestureKind
  /** Decided by the modifiers held as the drag began, and fixed for its length. */
  op: SelectionOp
  page: string
  w: number
  h: number
  origin: Point
  current: Point
  constrain: boolean
  fromCenter: boolean
  points: Point[]
  pointerDown: boolean
  /** Vertices taken back inside this gesture, so it can redo its own. */
  undone: Point[]
}

/**
 * Whether clicks rather than one drag build this gesture — which is also the
 * only kind a release does not finish.
 */
export function isPolygonGesture(g: SelectionGesture): boolean {
  return g.kind === 'lasso-polygon'
}

/** What the pointer is asking for, read fresh on every move. */
export interface GestureModifiers {
  constrain: boolean
  fromCenter: boolean
  /** Alt, which draws a freehand segment inside a polygon lasso. */
  freehand: boolean
}

/** The mask as it should be shown, which during a drag is not the held one. */
export interface SelectionDisplay extends MaskWindow {
  page: string
  bounds: Rect | null
}

/**
 * One selection, and it knows which page it is for. Leaving that page hides it;
 * it is only replaced when a selection is made somewhere else. Nothing here
 * reaches `manifest.json` — a selection is editor state that dies with the
 * project, exactly as in Photoshop.
 *
 * The coverage itself lives in the engine, on the same tile grid the pixels use:
 * same growth, same origin, same copy-on-write, one byte a pixel instead of
 * four. Nothing about what a selection *is* changed with it — what changed is
 * the bill. A full-page mask at the largest page is 139 MB, and selecting all or
 * inverting has the whole page as its changed region, so two of those in history
 * was 278 MB for one command; as tiles it is tens of thousands of pointers at a
 * single four-kilobyte block.
 *
 * What is left here is the reactive half, which is small enough to be worth
 * watching: where the selection is, which page it is on, and a counter saying it
 * moved. Pinia's devtools plugin walks `$state` key by key with no length limit,
 * so a page of bytes put there would be stringified on every mutation — the
 * arrays that pass through are deliberately plain locals.
 */
export const useSelectionStore = defineStore('selection', () => {
  /** Mirrored from the engine after every change, never written to directly. */
  let held: MaskTarget | null = null

  const bounds = ref<Rect | null>(null)
  /** Bumped whenever what should be on screen changed, gestures included. */
  const revision = ref(0)
  const quickMask = ref(false)
  const gesture = shallowRef<SelectionGesture | null>(null)
  /**
   * One set of settings per direction, as in Photoshop, where every painting
   * tool remembers its own. Shared settings would mean sizing the eraser
   * silently resizes the brush — and the size control exists to be reached for
   * often, so that surprise would land constantly rather than once.
   */
  const brushes = ref<Record<MaskBrushMode, BrushSettings>>({
    paint: { size: DEFAULT_BRUSH_SIZE, hardness: DEFAULT_BRUSH_HARDNESS },
    erase: { size: DEFAULT_BRUSH_SIZE, hardness: DEFAULT_BRUSH_HARDNESS },
  })

  const hasSelection = computed(() => bounds.value !== null)
  const isDrawing = computed(() => gesture.value !== null)

  /**
   * Takes the engine's answer as this store's own.
   *
   * Which page, how big and where the edges are all move together, so they are
   * read together — asking separately is three chances to act on a half-updated
   * answer.
   */
  function sync(): void {
    const state = window.engine.maskState()
    const at = state.bounds
    held =
      state.page === undefined
        ? null
        : { page: state.page, w: state.width, h: state.height }
    bounds.value = at === undefined ? null : { x: at.x, y: at.y, w: at.w, h: at.h }
  }

  function isHeldFor(target: MaskTarget): boolean {
    return (
      held !== null &&
      held.page === target.page &&
      held.w === target.w &&
      held.h === target.h
    )
  }

  /** The mask's own bytes over a rectangle, row by row. */
  function readWindow(region: Rect): MaskWindow {
    const at = held === null ? EMPTY_RECT : clampToPage(region, held.w, held.h)
    if (isEmptyRect(at)) return { region: EMPTY_RECT, bytes: new Uint8ClampedArray(0) }
    return { region: at, bytes: new Uint8ClampedArray(window.engine.maskRead(at)) }
  }

  function writeWindow(window_: MaskWindow): string {
    return window.engine.maskWrite(window_.region, new Uint8Array(window_.bytes))
  }

  /**
   * Selection history joins the document's own command stack, so one Ctrl+Z
   * means one thing. It leaves the project clean: nothing here writes a page,
   * so nothing here dirties one or moves its `revision` on.
   *
   * A step can be several records — starting a selection on another page puts
   * the old one away and then writes, and both have to come back together. Undo
   * runs them backwards because each is its own inverse, so the last to happen
   * is the first to be taken back.
   *
   * `focus` is the page the command acted on, for the side of it that holds no
   * mask: undoing the first selection of a session leaves nothing to look at,
   * and the page it was made on is still where the person should be looking.
   */
  function pushMaskCommand(label: string, journals: readonly string[], focus: string): void {
    if (journals.length === 0) return
    const run = (order: readonly string[]) => {
      // A gesture is a preview over a mask that is about to be replaced under
      // it, so it cannot outlive the replacement.
      cancelGesture()
      for (const journal of order) window.engine.maskApplyJournal(journal)
      sync()
      revision.value++
      // Undoing something you have navigated away from should show you what it
      // undid. Navigation itself is not history, so this rides along on the
      // command rather than being a step of its own.
      useEditorStore().showPage(held?.page ?? focus)
    }
    const forwards = [...journals]
    const backwards = [...journals].reverse()
    useEditorStore().pushCommand(
      {
        label,
        do: () => run(forwards),
        undo: () => run(backwards),
        forget: () => {
          for (const journal of journals) window.engine.maskDropJournal(journal)
        },
      },
      { alreadyApplied: true },
    )
  }

  /**
   * The selection's own bytes inside a region, row by row — what anything
   * turning a selection into pixels needs. Null when the page holds no
   * selection.
   */
  function maskPatchOf(page: string, region: Rect): Uint8ClampedArray | null {
    if (held === null || held.page !== page) return null
    return readWindow(region).bytes
  }

  /** Where a selection is being held, whether or not that page is on screen. */
  function heldPage(): string | null {
    return held?.page ?? null
  }

  function applyShape(
    target: MaskTarget,
    shape: ShapeRaster,
    op: SelectionOp,
    label: string,
  ): void {
    const sameHeld = isHeldFor(target)
    const heldBounds = sameHeld ? bounds.value : null
    const effective = normalizeOp(op, heldBounds)
    if (effective === null) return

    if (isEmptyRect(shape.bounds)) {
      // A click rather than a drag. With a marquee that deselects, as in
      // Photoshop; the other operations simply have nothing to work with.
      // Only what is on the page clicked, though — a click here is no reason to
      // throw away a lasso drawn on some other page.
      if (effective === 'new' && heldPage() === target.page) deselect()
      return
    }

    const region = clampToPage(regionFor(effective, heldBounds, shape.bounds), target.w, target.h)
    if (isEmptyRect(region)) return

    const journals: string[] = []
    if (!sameHeld) journals.push(window.engine.maskHold(target.page, target.w, target.h))
    const base = sameHeld ? readWindow(region).bytes : null
    journals.push(writeWindow({ region, bytes: composeWindow(base, shape, effective, region) }))
    sync()
    revision.value++
    pushMaskCommand(label, journals, target.page)
  }

  function deselect(): void {
    // An emptied mask is a page of zeroes rather than a selection, and there is
    // nothing for history to take back from it.
    if (held === null || bounds.value === null) return
    const focus = held.page
    const journal = window.engine.maskDeselect()
    sync()
    revision.value++
    pushMaskCommand('deselect', [journal], focus)
  }

  function selectAll(target: MaskTarget): void {
    const journals: string[] = []
    if (!isHeldFor(target)) journals.push(window.engine.maskHold(target.page, target.w, target.h))
    journals.push(window.engine.maskSelectAll())
    sync()
    revision.value++
    pushMaskCommand('select-all', journals, target.page)
  }

  function invert(target: MaskTarget): void {
    const journals: string[] = []
    if (!isHeldFor(target)) journals.push(window.engine.maskHold(target.page, target.w, target.h))
    journals.push(window.engine.maskInvert())
    sync()
    revision.value++
    pushMaskCommand('invert-selection', journals, target.page)
  }

  // ---- gestures ------------------------------------------------------------

  /**
   * A gesture under way is tool state and the held mask does not move until it
   * is committed, which is what makes cancelling one — by Escape, by changing
   * tool, by turning the page — always clean.
   */
  function beginGesture(
    kind: SelectionGestureKind,
    op: SelectionOp,
    target: MaskTarget,
    at: Point,
  ): void {
    gesture.value = {
      kind,
      op,
      page: target.page,
      w: target.w,
      h: target.h,
      origin: at,
      current: at,
      constrain: false,
      fromCenter: false,
      points: [at],
      pointerDown: true,
      undone: [],
    }
    revision.value++
  }

  /** Freehand points closer than this to the last one say nothing worth storing. */
  const FREEHAND_MIN_STEP = 1

  function appendPoint(g: SelectionGesture, at: Point): void {
    const last = g.points[g.points.length - 1]
    if (
      last !== undefined &&
      Math.abs(at.x - last.x) < FREEHAND_MIN_STEP &&
      Math.abs(at.y - last.y) < FREEHAND_MIN_STEP
    ) {
      return
    }
    g.points.push(at)
    g.undone.length = 0
  }

  function trackPointer(at: Point, mods: GestureModifiers): void {
    const g = gesture.value
    if (g === null) return
    g.current = at
    g.constrain = mods.constrain
    g.fromCenter = mods.fromCenter
    // A polygon only takes a vertex on a click; Alt with the button down is the
    // one exception, which is how a freehand stretch is drawn into one.
    if ((g.kind === 'lasso' || g.kind === 'lasso-polygon') && g.pointerDown) {
      if (!isPolygonGesture(g) || mods.freehand) appendPoint(g, at)
    }
    revision.value++
  }

  /**
   * What a release means. Only a polygon survives one, because a polygon is
   * built from clicks and the button coming up is one of them. Everything else —
   * a marquee, a freehand lasso — is a single drag, and letting go ends it.
   *
   * Deliberately not asking what Alt is doing at this moment. Alt already said
   * "subtract" when the drag began, and reading it again here would leave a
   * subtracting lasso unable to finish by the ordinary means.
   */
  function releasePointer(mods: { moved: boolean }): 'commit' | 'open' {
    const g = gesture.value
    if (g === null || !isPolygonGesture(g)) return 'commit'
    if (!mods.moved) appendPoint(g, g.current)
    g.pointerDown = false
    revision.value++
    return 'open'
  }

  /** A click on an open polygon, which either extends it or takes a vertex back. */
  function pressPointer(at: Point): void {
    const g = gesture.value
    if (g === null) return
    g.pointerDown = true
    g.current = at
    revision.value++
  }

  /**
   * The pointer's own position stands in as a provisional last vertex while a
   * polygon waits for its next click, so the shape follows the hand between
   * clicks instead of jumping on each one.
   */
  function shapePoints(g: SelectionGesture): readonly Point[] {
    return isPolygonGesture(g) && !g.pointerDown ? [...g.points, g.current] : g.points
  }

  /**
   * The one place a gesture becomes a shape. Preview and commit both come
   * through here and then through `composeWindow`, which is what stops what is
   * drawn during a drag from disagreeing with what the release leaves behind.
   */
  function gestureShape(g: SelectionGesture): ShapeRaster {
    const page = { w: g.w, h: g.h }
    if (g.kind === 'marquee-rect') return rasterizeRect(page, marqueeRect(g))
    if (g.kind === 'marquee-ellipse') return rasterizeEllipse(page, marqueeRect(g))
    return rasterizePolygon(page, shapePoints(g))
  }

  let shapeCache: ShapeRaster | null = null
  let shapeAt = -1

  /** The gesture's shape, rasterized once however many readers ask for it. */
  function currentShape(): ShapeRaster | null {
    const g = gesture.value
    if (g === null) return null
    if (shapeAt !== revision.value) {
      shapeAt = revision.value
      shapeCache = gestureShape(g)
    }
    return shapeCache
  }

  function commitGesture(): void {
    const g = gesture.value
    if (g === null) return
    // The very raster the preview was drawn from, not a second one computed the
    // same way — identical by construction rather than by inspection.
    const shape = currentShape()
    if (shape === null) return
    gesture.value = null
    applyShape({ page: g.page, w: g.w, h: g.h }, shape, g.op, `select-${g.kind}`)
    revision.value++
  }

  function cancelGesture(): void {
    if (gesture.value === null) return
    gesture.value = null
    revision.value++
  }

  /**
   * Ctrl+Z inside a gesture takes back a vertex, and reports that it did so —
   * running out cancels the whole gesture rather than reaching past it. An
   * unfinished shape is not in the document, so letting the key through would
   * undo whatever happened before the gesture started while the half-drawn
   * shape sat there untouched.
   */
  function gestureUndo(): boolean {
    const g = gesture.value
    if (g === null) return false
    const last = g.points.pop()
    if (last === undefined || g.points.length === 0) {
      cancelGesture()
      return true
    }
    g.undone.push(last)
    revision.value++
    return true
  }

  /**
   * Redo from the first day. Half of it is worse than none: every other editor
   * that added in-gesture undo without it left a key that visibly loses work,
   * and the vertices here are plain points with no derived geometry hanging off
   * them, which is the thing that made it hard elsewhere.
   */
  function gestureRedo(): boolean {
    const g = gesture.value
    if (g === null) return false
    const back = g.undone.pop()
    if (back === undefined) return true
    g.points.push(back)
    revision.value++
    return true
  }

  // ---- brush ---------------------------------------------------------------

  interface Stroke {
    target: MaskTarget
    mode: MaskBrushMode
    from: Point
    /** Where the mask was put away to start this stroke, when it had to be. */
    opened: string[]
    /**
     * The one record the whole stroke comes to. Every segment writes its own and
     * is folded into this, which keeps a stroke that crosses a tile two hundred
     * times from holding two hundred copies of it.
     */
    record: string | null
    dirty: Rect
  }
  let stroke: Stroke | null = null

  function brushRadiusFor(mode: MaskBrushMode): number {
    return brushes.value[mode].size / 2
  }

  /**
   * A stroke is one entry in the stack however long it is, and it writes into
   * the held mask straight away so Quick Mask keeps up with the hand — the same
   * split every drag on this canvas uses.
   */
  function beginStroke(target: MaskTarget, mode: MaskBrushMode, at: Point): void {
    const opened: string[] = []
    if (!isHeldFor(target)) {
      opened.push(window.engine.maskHold(target.page, target.w, target.h))
      sync()
    }
    stroke = { target, mode, from: at, opened, record: null, dirty: EMPTY_RECT }
    strokeTo(at)
  }

  /**
   * Which rectangle each of the last few revisions touched, for readers that
   * can repaint a part instead of the whole mask.
   *
   * Only the brush writes here, because it is the only mutation that reports a
   * region and the only one fast enough to outrun a full repaint. Every other
   * revision leaves a gap in this log, and a gap is what `dirtySince` reads as
   * "you cannot patch your way to this state" — so a reader that misses one is
   * wrong slowly rather than silently.
   */
  const dirtyLog: { rev: number; rect: Rect }[] = []
  const DIRTY_LOG_LIMIT = 512

  /**
   * What has changed since revision `seen`, or null when that cannot be
   * answered from a region — the caller then has to rebuild from the mask.
   */
  function dirtySince(seen: number): Rect | null {
    if (seen === revision.value) return EMPTY_RECT
    if (seen > revision.value) return null
    let out = EMPTY_RECT
    let want = seen + 1
    for (const entry of dirtyLog) {
      if (entry.rev < want) continue
      // A revision nobody logged sits between the two states: not patchable.
      if (entry.rev !== want) return null
      out = unionRect(out, entry.rect)
      want++
    }
    return want === revision.value + 1 ? out : null
  }

  /**
   * How far past the segment a stamp can reach, which is the window the stroke
   * has to read before it can write. Anything narrower would clip the brush's
   * own falloff at the edge of what was fetched.
   */
  function strokeWindowFor(s: Stroke, to: Point, radius: number): Rect {
    const pad = Math.ceil(radius) + 2
    const x = Math.min(s.from.x, to.x) - pad
    const y = Math.min(s.from.y, to.y) - pad
    return clampToPage(
      {
        x: Math.floor(x),
        y: Math.floor(y),
        w: Math.ceil(Math.abs(to.x - s.from.x)) + pad * 2 + 1,
        h: Math.ceil(Math.abs(to.y - s.from.y)) + pad * 2 + 1,
      },
      s.target.w,
      s.target.h,
    )
  }

  function strokeTo(at: Point): void {
    const s = stroke
    if (s === null) return
    const radius = brushRadiusFor(s.mode)
    const region = strokeWindowFor(s, at, radius)
    if (isEmptyRect(region)) {
      s.from = at
      return
    }
    const window_ = readWindow(region)
    const local = strokeMask(
      window_.bytes,
      region.w,
      region.h,
      { x: s.from.x - region.x, y: s.from.y - region.y },
      { x: at.x - region.x, y: at.y - region.y },
      radius,
      brushes.value[s.mode].hardness,
      s.mode,
    )
    s.from = at
    if (isEmptyRect(local)) return

    const dirty = { ...local, x: local.x + region.x, y: local.y + region.y }
    const journal = writeWindow(window_)
    if (s.record === null) s.record = journal
    else window.engine.maskAbsorbJournal(s.record, journal)
    sync()
    s.dirty = unionRect(s.dirty, dirty)
    revision.value++
    dirtyLog.push({ rev: revision.value, rect: dirty })
    if (dirtyLog.length > DIRTY_LOG_LIMIT) dirtyLog.shift()
  }

  function endStroke(): void {
    const s = stroke
    stroke = null
    if (s === null) return
    /*
     * A stroke that drew nothing — a brush sized to nothing, a press with no
     * travel outside the page — is not a step. Anything it did to get ready is
     * taken back here rather than left standing: putting the last selection
     * away and then drawing nothing would otherwise destroy it with no step in
     * the stack to take that back.
     */
    if (s.record === null) {
      for (const journal of [...s.opened].reverse()) {
        window.engine.maskApplyJournal(journal)
        window.engine.maskDropJournal(journal)
      }
      sync()
      revision.value++
      return
    }
    pushMaskCommand(
      s.mode === 'paint' ? 'paint-selection' : 'erase-selection',
      [...s.opened, s.record],
      s.target.page,
    )
  }

  /**
   * Proportional steps, so `[` and `]` are useful at both ends of the range —
   * one pixel at a time out of four hundred is not a size control.
   */
  function nudgeBrushSize(mode: MaskBrushMode, direction: 1 | -1): void {
    const settings = brushes.value[mode]
    const step = Math.max(1, Math.round(settings.size * 0.1))
    settings.size = Math.min(
      MAX_BRUSH_SIZE,
      Math.max(MIN_BRUSH_SIZE, settings.size + step * direction),
    )
  }

  function toggleQuickMask(): void {
    quickMask.value = !quickMask.value
  }

  // ---- what to draw --------------------------------------------------------

  let display: SelectionDisplay | null = null
  let displayAt = -1
  let outlineCache: Point[][] = []
  let outlinesAt = -1

  /** The selection as it stands, with no gesture over it. */
  function heldDisplay(): SelectionDisplay | null {
    if (held === null || bounds.value === null) return null
    return { ...readWindow(bounds.value), page: held.page, bounds: bounds.value }
  }

  /**
   * What a drag is describing, over the selection it will land on.
   *
   * The window spans everything the two of them together could cover, so the
   * ants and the wash see the whole answer rather than the part that moved. It
   * is bounded by the selection, not by the page — which is the one thing the
   * page-sized buffer this replaced could not say.
   */
  function computeDisplay(): SelectionDisplay | null {
    const g = gesture.value
    if (g === null) return heldDisplay()

    const target = { page: g.page, w: g.w, h: g.h }
    const sameHeld = isHeldFor(target)
    const heldBounds = sameHeld ? bounds.value : null
    const effective = normalizeOp(g.op, heldBounds)
    const shape = currentShape()
    if (effective === null || shape === null) return heldDisplay()

    const region = clampToPage(unionRect(heldBounds ?? EMPTY_RECT, shape.bounds), g.w, g.h)
    if (isEmptyRect(region)) return heldDisplay()
    const base = sameHeld ? readWindow(region).bytes : null
    const window_: MaskWindow = { region, bytes: composeWindow(base, shape, effective, region) }
    return { ...window_, page: g.page, bounds: boundsOfWindow(window_) }
  }

  /** What belongs on screen for this page: the held mask, or a drag over it. */
  function displayFor(page: string): SelectionDisplay | null {
    if (displayAt !== revision.value) {
      displayAt = revision.value
      display = computeDisplay()
    }
    return display !== null && display.page === page ? display : null
  }

  /** The marching ants, as closed outlines in page coordinates. */
  function outlinesFor(page: string): Point[][] {
    const shown = displayFor(page)
    if (shown === null || shown.bounds === null) return []
    if (outlinesAt !== revision.value) {
      outlinesAt = revision.value
      const at = shown.region
      outlineCache = traceMaskOutlines(shown.bytes, at.w, at.h, {
        x: shown.bounds.x - at.x,
        y: shown.bounds.y - at.y,
        w: shown.bounds.w,
        h: shown.bounds.h,
      }).map((loop) => loop.map((p) => ({ x: p.x + at.x, y: p.y + at.y })))
    }
    return outlineCache
  }

  let shapeOutlineCache: Point[][] = []
  let shapeOutlinesAt = -1

  /**
   * The outline of the region a gesture is describing right now, apart from what
   * that region will do to the selection.
   *
   * Two separate things are worth seeing while subtracting: the selection as it
   * will end up, and the shape being taken out of it. Quick Mask needs this most
   * — a wash has no crisp edge to read, so without it a drag in that mode shows
   * its effect and never its boundary.
   */
  function shapeOutlinesFor(page: string): Point[][] {
    const g = gesture.value
    if (g === null || g.page !== page) return []
    const shape = currentShape()
    if (shape === null || isEmptyRect(shape.bounds)) return []
    if (shapeOutlinesAt !== revision.value) {
      shapeOutlinesAt = revision.value
      const at = shape.bounds
      shapeOutlineCache = traceMaskOutlines(shape.coverage, at.w, at.h, {
        x: 0,
        y: 0,
        w: at.w,
        h: at.h,
      }).map((loop) => loop.map((p) => ({ x: p.x + at.x, y: p.y + at.y })))
    }
    return shapeOutlineCache
  }

  /**
   * The line a polygon is being built from, while it still encloses nothing.
   *
   * One and two vertices describe no region at all, so there is nothing to
   * outline and nothing would be on screen — the first two clicks would land
   * invisibly. From three vertices on, the region's own outline says everything
   * this line would, and drawing both only muddies the placed segments.
   */
  function buildingPathFor(page: string): readonly Point[] {
    const g = gesture.value
    if (g === null || g.page !== page || !isPolygonGesture(g)) return []
    const shape = currentShape()
    if (shape !== null && !isEmptyRect(shape.bounds)) return []
    return shapePoints(g)
  }

  /**
   * The history belongs to the project that made it, and so does the selection:
   * two projects can hold a page of the same name.
   */
  function reset(): void {
    window.engine.maskReset()
    held = null
    stroke = null
    gesture.value = null
    bounds.value = null
    quickMask.value = false
    revision.value++
  }

  return {
    bounds,
    revision,
    quickMask,
    gesture,
    brushes,
    brushRadiusFor,
    hasSelection,
    isDrawing,
    maskPatchOf,
    heldPage,
    readWindow,
    displayFor,
    dirtySince,
    outlinesFor,
    shapeOutlinesFor,
    buildingPathFor,
    applyShape,
    deselect,
    selectAll,
    invert,
    beginGesture,
    trackPointer,
    pressPointer,
    releasePointer,
    commitGesture,
    cancelGesture,
    gestureUndo,
    gestureRedo,
    beginStroke,
    strokeTo,
    endStroke,
    nudgeBrushSize,
    toggleQuickMask,
    reset,
  }
})
