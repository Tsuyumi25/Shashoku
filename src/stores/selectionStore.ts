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
  boundsOfMask,
  composeInto,
  invertInto,
  normalizeOp,
  readPatch,
  regionFor,
  writePatch,
  type MaskTarget,
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
export interface SelectionDisplay {
  mask: Uint8ClampedArray
  page: string
  w: number
  h: number
  bounds: Rect | null
}

/**
 * One selection, and it knows which page it is for. Leaving that page hides it;
 * it is only replaced when a selection is made somewhere else. Nothing here
 * reaches `manifest.json` — a selection is editor state that dies with the
 * project, exactly as in Photoshop.
 *
 * The mask itself is deliberately not part of the store's state. Pinia's
 * devtools plugin walks `$state` key by key and reads every value, with no
 * length limit and no way to opt a field out, so a page-sized byte array put
 * there would be stringified on every mutation while the panel is open —
 * `shallowRef` and `markRaw` only turn off Vue's proxy and do nothing to that
 * path. The reactive half is what is small enough to be worth watching: where
 * the selection is, and a counter saying it moved.
 */
export const useSelectionStore = defineStore('selection', () => {
  let mask: Uint8ClampedArray | null = null
  let held: MaskTarget | null = null
  /**
   * The page a drag is previewed into, so the held mask is untouched until the
   * release — which is what makes cancelling a gesture free.
   */
  let scratch: Uint8ClampedArray | null = null
  let previewDirty: Rect = EMPTY_RECT

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

  function isHeldFor(target: MaskTarget): boolean {
    return (
      mask !== null &&
      held !== null &&
      held.page === target.page &&
      held.w === target.w &&
      held.h === target.h
    )
  }

  /**
   * The mask for this page, allocating one if what is held is for somewhere
   * else. Replacing it is what "one selection" means: making a selection on
   * another page is what takes the last one away, not turning to that page.
   */
  function ensureMask(target: MaskTarget): Uint8ClampedArray {
    if (isHeldFor(target)) return mask as Uint8ClampedArray
    mask = new Uint8ClampedArray(target.w * target.h)
    held = { ...target }
    bounds.value = null
    return mask
  }

  /**
   * `scan` must contain the answer. An operation's changed region unioned with
   * the previous bounds always does, and saying so turns a page-wide sweep into
   * a look at the box that moved.
   */
  function refreshBounds(scan: Rect): void {
    if (mask === null || held === null) {
      bounds.value = null
      return
    }
    bounds.value = boundsOfMask(mask, held.w, held.h, scan)
  }

  /**
   * Enough of a mask to put it back. A command holds two of these; `page: null`
   * is the state of having no selection at all, which is what deselecting
   * undoes to and what the first selection of a session undoes to.
   *
   * A snapshot of a whole page's selection is only taken where one is really
   * being destroyed — deselecting, or selecting on a different page. Every
   * ordinary operation records the box it touched.
   */
  type MaskSnapshot =
    | { page: null }
    | { page: string; w: number; h: number; region: Rect; bytes: Uint8ClampedArray }

  function snapshotRegion(region: Rect): MaskSnapshot {
    if (mask === null || held === null) return { page: null }
    return {
      page: held.page,
      w: held.w,
      h: held.h,
      region,
      bytes: readPatch(mask, held.w, region),
    }
  }

  function snapshotAll(): MaskSnapshot {
    return snapshotRegion(bounds.value ?? EMPTY_RECT)
  }

  /**
   * `focus` is the page the command acted on, for the side of it that holds no
   * mask: undoing the first selection of a session leaves nothing to look at,
   * and the page it was made on is still where the person should be looking.
   */
  function restore(snapshot: MaskSnapshot, focus: string): void {
    // A gesture is a preview over a mask that is about to be replaced under it,
    // so it cannot outlive the replacement.
    cancelGesture()
    if (snapshot.page === null) {
      mask = null
      held = null
      scratch = null
      bounds.value = null
      revision.value++
      useEditorStore().showPage(focus)
      return
    }
    const target = { page: snapshot.page, w: snapshot.w, h: snapshot.h }
    const previous = bounds.value
    const replaced = !isHeldFor(target)
    const live = ensureMask(target)
    writePatch(live, target.w, snapshot.region, snapshot.bytes)
    scratch = null
    refreshBounds(replaced ? snapshot.region : unionRect(previous ?? EMPTY_RECT, snapshot.region))
    revision.value++
    // Undoing something you have navigated away from should show you what it
    // undid. Navigation itself is not history, so this rides along on the
    // command rather than being a step of its own.
    useEditorStore().showPage(snapshot.page)
  }

  /**
   * Selection history joins the document's own command stack, so one Ctrl+Z
   * means one thing. It leaves the project clean: nothing here writes a page,
   * so nothing here dirties one or moves its `revision` on.
   */
  function pushMaskCommand(
    label: string,
    focus: string,
    before: MaskSnapshot,
    after: MaskSnapshot,
  ): void {
    useEditorStore().pushCommand(
      { label, do: () => restore(after, focus), undo: () => restore(before, focus) },
      { alreadyApplied: true },
    )
  }

  function maskFor(page: string): Uint8ClampedArray | null {
    return held !== null && held.page === page ? mask : null
  }

  /**
   * The selection's own bytes inside a region, row by row — what anything
   * turning a selection into pixels needs, without the page-wide array leaving
   * this store. Null when the page holds no selection.
   */
  function maskPatchOf(page: string, region: Rect): Uint8ClampedArray | null {
    if (mask === null || held === null || held.page !== page) return null
    return readPatch(mask, held.w, clampToPage(region, held.w, held.h))
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
    const before = sameHeld ? snapshotRegion(region) : snapshotAll()

    const live = ensureMask(target)
    composeInto(live, live, target.w, target.h, shape, effective, region)
    refreshBounds(unionRect(heldBounds ?? EMPTY_RECT, region))
    revision.value++
    pushMaskCommand(label, target.page, before, snapshotRegion(region))
  }

  function deselect(): void {
    // An emptied mask is a page of zeroes rather than a selection, and there is
    // nothing for history to take back from it.
    if (mask === null || held === null || bounds.value === null) return
    const focus = held.page
    const before = snapshotAll()
    mask = null
    held = null
    scratch = null
    bounds.value = null
    revision.value++
    pushMaskCommand('deselect', focus, before, { page: null })
  }

  function selectAll(target: MaskTarget): void {
    const whole = { x: 0, y: 0, w: target.w, h: target.h }
    const sameHeld = isHeldFor(target)
    const before = sameHeld ? snapshotRegion(whole) : snapshotAll()
    const live = ensureMask(target)
    live.fill(255)
    bounds.value = { ...whole }
    revision.value++
    pushMaskCommand('select-all', target.page, before, snapshotRegion(whole))
  }

  function invert(target: MaskTarget): void {
    const whole = { x: 0, y: 0, w: target.w, h: target.h }
    const sameHeld = isHeldFor(target)
    const before = sameHeld ? snapshotRegion(whole) : snapshotAll()
    const source = sameHeld ? mask : null
    const next = new Uint8ClampedArray(target.w * target.h)
    invertInto(next, source)
    mask = next
    held = { ...target }
    scratch = null
    refreshBounds(whole)
    revision.value++
    pushMaskCommand('invert-selection', target.page, before, snapshotRegion(whole))
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
    // Copied once per gesture rather than per frame: every frame then rewrites
    // only what it dirties, and everything else is already what is held.
    scratch = new Uint8ClampedArray(target.w * target.h)
    if (isHeldFor(target) && mask !== null) scratch.set(mask)
    previewDirty = EMPTY_RECT
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
   * through here and then through `composeInto`, which is what stops what is
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
    scratch = null
    previewDirty = EMPTY_RECT
    applyShape({ page: g.page, w: g.w, h: g.h }, shape, g.op, `select-${g.kind}`)
    revision.value++
  }

  function cancelGesture(): void {
    if (gesture.value === null) return
    gesture.value = null
    scratch = null
    previewDirty = EMPTY_RECT
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
    /** The mask as the stroke found it, for the one patch the stroke records. */
    baseline: Uint8ClampedArray
    /** Set only where the stroke took a selection away from another page. */
    outgoing: MaskSnapshot | null
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
    const outgoing = isHeldFor(target) ? null : snapshotAll()
    const live = ensureMask(target)
    stroke = {
      target,
      mode,
      from: at,
      baseline: new Uint8ClampedArray(live),
      outgoing,
      dirty: EMPTY_RECT,
    }
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

  function strokeTo(at: Point): void {
    const s = stroke
    if (s === null || mask === null) return
    const dirty = strokeMask(
      mask,
      s.target.w,
      s.target.h,
      s.from,
      at,
      brushRadiusFor(s.mode),
      brushes.value[s.mode].hardness,
      s.mode,
    )
    s.from = at
    s.dirty = unionRect(s.dirty, dirty)
    refreshBounds(unionRect(bounds.value ?? EMPTY_RECT, dirty))
    revision.value++
    dirtyLog.push({ rev: revision.value, rect: dirty })
    if (dirtyLog.length > DIRTY_LOG_LIMIT) dirtyLog.shift()
  }

  function endStroke(): void {
    const s = stroke
    stroke = null
    if (s === null || mask === null) return
    const region = clampToPage(s.dirty, s.target.w, s.target.h)
    if (isEmptyRect(region)) return
    const before: MaskSnapshot =
      s.outgoing ??
      {
        page: s.target.page,
        w: s.target.w,
        h: s.target.h,
        region,
        bytes: readPatch(s.baseline, s.target.w, region),
      }
    pushMaskCommand(
      s.mode === 'paint' ? 'paint-selection' : 'erase-selection',
      s.target.page,
      before,
      snapshotRegion(region),
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

  function computeDisplay(): SelectionDisplay | null {
    const live =
      mask !== null && held !== null
        ? { mask, page: held.page, w: held.w, h: held.h, bounds: bounds.value }
        : null
    const g = gesture.value
    if (g === null) return live

    const target = { page: g.page, w: g.w, h: g.h }
    const sameHeld = isHeldFor(target)
    const heldBounds = sameHeld ? bounds.value : null
    const effective = normalizeOp(g.op, heldBounds)
    if (effective === null || scratch === null) return live

    const shape = currentShape()
    if (shape === null) return live
    const region = clampToPage(regionFor(effective, heldBounds, shape.bounds), g.w, g.h)
    // Everything the last frame dirtied is recomputed, so no stale preview is
    // left behind when the shape shrinks. Every pixel is a function of the held
    // mask and the shape at that pixel, so a wider region is only more work.
    const write = unionRect(previewDirty, region)
    composeInto(scratch, sameHeld ? mask : null, g.w, g.h, shape, effective, write)
    previewDirty = region
    return {
      mask: scratch,
      page: g.page,
      w: g.w,
      h: g.h,
      bounds: boundsOfMask(scratch, g.w, g.h, unionRect(heldBounds ?? EMPTY_RECT, write)),
    }
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
      outlineCache = traceMaskOutlines(shown.mask, shown.w, shown.h, shown.bounds)
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
    mask = null
    held = null
    scratch = null
    stroke = null
    previewDirty = EMPTY_RECT
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
    maskFor,
    maskPatchOf,
    heldPage,
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
