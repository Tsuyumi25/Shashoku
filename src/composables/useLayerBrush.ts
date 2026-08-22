import type { Ref } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import { layersDirOf } from '@shared/ssk/constants'
import { useRasterTarget } from '@/composables/useRasterTarget'
import { hexToRgb } from '@/lib/color'
import { screenToContentPx } from '@/lib/coords'
import { strokeMask } from '@/lib/selection/brushMask'
import {
  clampToPage,
  EMPTY_RECT,
  isEmptyRect,
  unionRect,
  type Point,
  type Rect,
} from '@/lib/selection/rect'
import {
  coverageWithin,
  cutToMask,
  EMPTY_SURFACE,
  raiseInto,
  surfaceHolding,
  type StrokeSurface,
} from '@/lib/selection/strokeSurface'
import { maskBrushModeOf, useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'
import { useSelectionStore } from '@/stores/selectionStore'
import { useStrokeOverlayStore, type StrokeOverlayOp } from '@/stores/strokeOverlayStore'
import type { MaskBrushMode } from '@/lib/selection/brushMask'

/**
 * A stroke under way, and everything it will need at the release.
 *
 * The layer, the page and its size are read once at the press and held. A
 * stroke is one gesture against one layer, and re-reading which layer is
 * selected on every segment would let a click in the panel move the paint
 * mid-stroke.
 *
 * The colour and the alpha lock are held for the same reason and one more: the
 * release waits on a handover, so the commit runs after the hand has let go and
 * the eyedropper and the layer tree are reachable again. Read there, they would
 * write a stroke nobody watched being drawn.
 */
interface Stroke {
  page: string
  pageW: number
  pageH: number
  entry: RasterLayerEntry
  mode: MaskBrushMode
  color: string
  alphaLocked: boolean
  from: Point
  /**
   * What the stroke has covered, already cut to the selection.
   *
   * Cut where it is laid down rather than where it is handed over, because the
   * selection can come and go under the hand: deselecting is a key, and the
   * hand is busy holding the pointer. Cutting at the release would take a rule
   * that only ever applied from that moment on and apply it to everything
   * already drawn — and already seen cut on screen.
   */
  surface: StrokeSurface
  /** The box every stamp so far has landed in, which is what gets committed. */
  dirty: Rect
  /** The layer's handover, begun with the press and awaited at the release. */
  taken: Promise<void>
  /** This stroke's claim on the overlay, which only it may take down. */
  shown: number
}

/**
 * One stroke's release at a time, in the order the hand drew them.
 *
 * A release waits on the layer's handover, and how long that takes depends on
 * whether the layer had been touched before — so a quick second stroke on a
 * layer already over there can otherwise overtake a first one that is still
 * reading a file, and reach the undo stack ahead of it. The stack would then
 * take them back in the order they finished rather than the order they were
 * drawn, which is not an order anybody watched happen.
 */
let releases: Promise<void> = Promise.resolve()

/**
 * The brush and the eraser, painting the selected raster layer.
 *
 * Nothing reaches the engine until the button comes up. The stroke accumulates
 * its own coverage here and the release hands that over once, through the same
 * path a fill takes — a scratch layer, the mask applied as it lands, one
 * transaction, one swappable record. That is what makes a stroke one step in
 * the stack however many segments it was drawn from.
 *
 * What is on screen while the hand is down is that coverage painted onto a
 * canvas of the stroke's own, drawn over the layer by the stack. The engine is
 * not asked, which is the point: it was asked once per pointer event, and the
 * answer is a region of pixels — megabytes a frame under a wide brush moving
 * quickly, and the boundary crossing was the cost of the whole feature.
 *
 * Coverage accumulates the same way in both directions: which of them this is
 * decides nothing until the commit picks the operator. Erasing has nothing of
 * its own in the data model, which is also why it cannot be stopped by the
 * layer's alpha lock — there is no fill for the lock to hold back, only a hole.
 */
export function useLayerBrush(container: Ref<HTMLElement | null>) {
  const editor = useEditorStore()
  const project = useProjectStore()
  const selection = useSelectionStore()
  const notices = useNoticeStore()
  const preferences = usePreferencesStore()
  const raster = useRasterStore()
  const overlay = useStrokeOverlayStore()
  const { target, refuse } = useRasterTarget()

  let stroke: Stroke | null = null

  /**
   * What a preview is worked out in, kept between events instead of allocated
   * per one.
   *
   * A 500 px brush stamps a quarter of a million pixels, so a fresh coverage
   * array and a fresh `ImageData` every pointer event is around a megabyte of
   * garbage a frame — and the collector is most of what is left of the dropped
   * frames now that a stroke no longer crosses the addon boundary. The ink one
   * saves a second thing outright: `new ImageData` clears a buffer that the very
   * next lines overwrite in full.
   *
   * The release does not use them. It asks for the whole of what the stroke
   * covered, which would leave these as wide as the widest stroke of the session
   * for as long as the page is open, and it happens once.
   */
  let coverageScratch = new Uint8Array(0)
  let inkScratch = new Uint8ClampedArray(0)
  let stampScratch = new Uint8ClampedArray(0)

  function pageAt(e: MouseEvent): Point | null {
    const el = container.value
    if (!el) return null
    return screenToContentPx(e.clientX, e.clientY, el.getBoundingClientRect(), editor.view)
  }

  /**
   * Which direction this press is, or null when it is not this handler's.
   *
   * Quick Mask is what the same two tools point at the selection instead, so
   * the mode being on is the whole of the question — the tools themselves are
   * one brush and one eraser either way.
   */
  function directionFor(): MaskBrushMode | null {
    if (selection.quickMask) return null
    return maskBrushModeOf(editor.tool)
  }

  /**
   * How far past the segment a stamp can reach, which is what the surface has
   * to cover before the segment can be drawn into it.
   */
  function segmentWindow(from: Point, to: Point, radius: number): Rect {
    const pad = Math.ceil(radius) + 2
    return {
      x: Math.floor(Math.min(from.x, to.x) - pad),
      y: Math.floor(Math.min(from.y, to.y) - pad),
      w: Math.ceil(Math.abs(to.x - from.x)) + pad * 2 + 1,
      h: Math.ceil(Math.abs(to.y - from.y)) + pad * 2 + 1,
    }
  }

  function strokeTo(at: Point): void {
    const s = stroke
    if (s === null) return
    const shape = selection.brushShapeFor(s.mode)
    const window = clampToPage(segmentWindow(s.from, at, shape.radius), s.pageW, s.pageH)
    s.surface = surfaceHolding(s.surface, window, s.pageW, s.pageH)
    if (isEmptyRect(window) || isEmptyRect(s.surface.region)) {
      s.from = at
      return
    }
    overlay.holding(s.surface.region)

    const stamped = stampedOver(window)
    // Always the painting direction: this is coverage, and the eraser's coverage
    // is laid down exactly like the brush's. The operator is the commit's.
    const local = strokeMask(
      stamped,
      window.w,
      window.h,
      { x: s.from.x - window.x, y: s.from.y - window.y },
      { x: at.x - window.x, y: at.y - window.y },
      shape,
      'paint',
    )
    s.from = at
    if (isEmptyRect(local)) return
    const segment = {
      x: local.x + window.x,
      y: local.y + window.y,
      w: local.w,
      h: local.h,
    }

    // In this order. The surface holds cut coverage, so a stamp raising it
    // straight in would put back whatever a feathered selection had thinned.
    cut(s, stamped, window, segment)
    raiseInto(s.surface, stamped, window)
    s.dirty = unionRect(s.dirty, segment)
    show(s, segment)
  }

  /**
   * A cleared buffer for one segment's stamps, kept between segments. It is the
   * segment's own so that the cut has something to act on before the ceiling
   * takes it.
   */
  function stampedOver(window: Rect): Uint8ClampedArray {
    const size = window.w * window.h
    if (stampScratch.length < size) stampScratch = new Uint8ClampedArray(size)
    const out = stampScratch.subarray(0, size)
    out.fill(0)
    return out
  }

  /** Cuts a segment's stamps to the selection as it stands, in place. */
  function cut(s: Stroke, stamped: Uint8ClampedArray, over: Rect, at: Rect): void {
    const within = clampToPage(at, s.pageW, s.pageH)
    if (isEmptyRect(within)) return
    const mask = selection.maskPatchOf(s.page, within)
    if (mask !== null) cutToMask(stamped, over, mask, within)
  }

  /**
   * Shows the stroke as it stands, over the segment just drawn.
   *
   * Only the segment: the overlay keeps what earlier segments put on it, and
   * coverage is a ceiling rather than a sum, so putting the same pixels down
   * again where the stroke crossed itself lands on the value already there.
   *
   * Nothing is committed and nothing is asked of the engine — which is also why
   * this works before the layer has been handed over. The first stamp of the
   * first stroke on a layer is visible while that handover is still in flight.
   */
  function show(s: Stroke, segment: Rect): void {
    if (isEmptyRect(segment)) return
    const size = segment.w * segment.h
    if (coverageScratch.length < size) coverageScratch = new Uint8Array(size)
    const coverage = coverageWithin(s.surface, segment, coverageScratch)
    overlay.show(inked(coverage, segment, s.color), segment)
  }

  /**
   * Coverage as pixels, in straight alpha: the colour is the colour and the
   * coverage is the alpha, which is what the engine's fill makes of the two.
   *
   * The eraser paints here as well and its colour is never seen —
   * `destination-out` reads the alpha and nothing else.
   */
  function inked(coverage: Uint8Array, at: Rect, color: string): ImageData {
    const { r, g, b } = hexToRgb(color) ?? { r: 0, g: 0, b: 0 }
    const size = coverage.length * 4
    if (inkScratch.length < size) inkScratch = new Uint8ClampedArray(size)
    const out = inkScratch
    for (let i = 0; i < coverage.length; i++) {
      const p = i * 4
      out[p] = r
      out[p + 1] = g
      out[p + 2] = b
      out[p + 3] = coverage[i]
    }
    // Handed over rather than copied, and drawn in the same task: the overlay
    // takes the pixels into its canvas, after which this is free to be the next
    // segment's. Sharing a buffer means the size has to be exactly `at`, so an
    // empty segment could not be answered here — the one caller returns first.
    return new ImageData(out.subarray(0, size), at.w, at.h)
  }

  function onPointerDown(e: PointerEvent): boolean {
    const mode = directionFor()
    if (mode === null) return false
    const page = editor.currentPageId
    const at = pageAt(e)
    if (page === null || at === null) return false
    const file = project.pageById(page)
    if (!file) return false

    /*
     * Both refusals are said out loud. A brush that leaves no mark is
     * indistinguishable from a broken one, and the reason is never on screen:
     * the layer it would have gone to is whichever the cursor is on, which may
     * be a folder, or locked by one collapsed out of sight.
     */
    const entry = target.value
    if (entry === null) {
      notices.say('選一個點陣圖層再畫')
      return true
    }
    if (refuse(page, entry)) return true

    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const taken = raster.take(entry, page, layersDirOf(file.pageDir), file.pageDir)
    // The release awaits this and sees the same rejection; this only keeps a
    // failure from being reported as an unhandled one while the stroke is out.
    void taken.catch(() => {})
    const alphaLocked = entry.alphaLocked
    const opened: Stroke = {
      page,
      pageW: file.page.width,
      pageH: file.page.height,
      entry,
      mode,
      color: editor.foreground,
      alphaLocked,
      from: at,
      surface: EMPTY_SURFACE,
      dirty: EMPTY_RECT,
      taken,
      shown: overlay.begin(entry.id, operatorFor(mode, alphaLocked)),
    }
    stroke = opened
    strokeTo(at)
    return true
  }

  /**
   * How the overlay meets the layer, which is the canvas's name for what the
   * release will do. The alpha lock has nothing to say to the eraser: there is
   * no fill for it to hold back, only a hole.
   *
   * Two of the three are exact. `source-atop` is the near one — it agrees with
   * the engine wherever the layer is opaque and parts from it along a soft rim;
   * see the overlay store for why no operator closes that.
   */
  function operatorFor(mode: MaskBrushMode, alphaLocked: boolean): StrokeOverlayOp {
    if (mode === 'erase') return 'destination-out'
    return alphaLocked ? 'source-atop' : 'source-over'
  }

  function onPointerMove(e: PointerEvent): boolean {
    if (stroke === null) return false
    const at = pageAt(e)
    if (at !== null) strokeTo(at)
    return true
  }

  /**
   * A cancelled pointer arrives here too and banks the stroke rather than
   * dropping it, which is this canvas's standing convention for work the system
   * interrupts.
   */
  function onPointerUp(): boolean {
    const s = stroke
    if (s === null) return false
    /*
     * Taken here rather than inside the release, because the release is queued
     * behind whatever is still finishing and by the time it runs another press
     * may have opened a stroke of its own — which it would then end instead of
     * this one.
     */
    stroke = null
    releases = releases.then(() => endStroke(s)).catch((err: unknown) => {
      console.error('stroke failed', err)
    })
    return true
  }

  async function endStroke(s: Stroke): Promise<void> {
    try {
      await bank(s)
    } finally {
      // A backstop. The happy path takes it down where the write goes up, so
      // that no frame is drawn holding both; this is for the paths that never
      // reach there — a handover that failed, an engine that refused.
      overlay.end(s.shown)
    }
  }

  async function bank(s: Stroke): Promise<void> {
    /*
     * A press that drew nothing — a brush sized to nothing, a click out past
     * the page — is not a step. Nothing has been handed to the engine yet, so
     * there is nothing to take back either.
     */
    if (isEmptyRect(s.dirty)) return

    const at = s.dirty
    // Outside a selection the stroke was cut to nothing as it was drawn, so
    // neither the pixels nor the frame can grow past it: a covered pixel is the
    // only kind the engine writes or measures a frame from.
    const coverage = coverageWithin(s.surface, at)

    await s.taken

    /*
     * Trimmed before the write allocates, never after. Building the record
     * first and pruning afterwards is how a stack peaks at its ceiling plus a
     * whole canvas.
     */
    editor.forgetJournals(
      window.engine.rasterTrimHistory(
        preferences.prefs.undoPixelSteps,
        preferences.prefs.undoPixelBytes,
      ),
    )

    const patch =
      s.mode === 'erase'
        ? window.engine.rasterErase(s.entry.id, coverage, at)
        : window.engine.rasterFill(s.entry.id, coverage, at, s.color, s.alphaLocked)
    /*
     * Taken down in the same task the write goes up in, so no frame is drawn
     * between the two. Dropped before the write rather than after, because the
     * write repaints as it lands and would otherwise draw the stroke twice —
     * once from the layer and once from an overlay saying the same thing.
     */
    overlay.end(s.shown)
    // Coverage that came to nothing once the selection had cut it, or a fully
    // transparent colour. Neither is a failure and neither is a step.
    if (patch === null) return
    raster.paste(s.entry.id, patch)
    await raster.owe(s.entry.id)

    // One function for both directions: the engine's record is a swap, so
    // applying it takes the stroke back and applying it again puts it there.
    // The frame rides along inside the same swap.
    const swap = () => {
      const back = window.engine.rasterApplyJournal(patch.journal)
      if (back !== null) raster.paste(s.entry.id, back)
      void raster.owe(s.entry.id)
    }
    editor.pushCommand(
      {
        label: `${s.mode === 'erase' ? 'erase' : 'paint'}-layer ${s.entry.id}`,
        journal: patch.journal,
        do: swap,
        undo: swap,
        forget: () => window.engine.rasterDropJournal(patch.journal),
      },
      { alreadyApplied: true },
    )
  }

  return { onPointerDown, onPointerMove, onPointerUp }
}
