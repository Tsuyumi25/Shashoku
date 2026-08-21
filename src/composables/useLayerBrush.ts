import type { Ref } from 'vue'
import type { EngineLayerPixels } from '@shared/engine/types'
import type { RasterLayerEntry } from '@shared/page/types'
import { layersDirOf } from '@shared/ssk/constants'
import { useRasterTarget } from '@/composables/useRasterTarget'
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
  surfaceHolding,
  type StrokeSurface,
} from '@/lib/selection/strokeSurface'
import { maskBrushModeOf, useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'
import { useSelectionStore } from '@/stores/selectionStore'
import type { MaskBrushMode } from '@/lib/selection/brushMask'

/**
 * A stroke under way, and everything it will need at the release.
 *
 * The layer, the page and its size are read once at the press and held. A
 * stroke is one gesture against one layer, and re-reading which layer is
 * selected on every segment would let a click in the panel move the paint
 * mid-stroke.
 */
interface Stroke {
  page: string
  pageW: number
  pageH: number
  entry: RasterLayerEntry
  mode: MaskBrushMode
  from: Point
  surface: StrokeSurface
  /** The box every stamp so far has landed in, which is what gets committed. */
  dirty: Rect
  /** The layer's handover, begun with the press and awaited at the release. */
  taken: Promise<void>
}

/**
 * The brush and the eraser, painting the selected raster layer.
 *
 * Nothing reaches the engine until the button comes up. The stroke accumulates
 * its own coverage here and the release hands that over once, through the same
 * path a fill takes — a scratch layer, the mask applied as it lands, one
 * transaction, one swappable record. That is what makes a stroke one step in
 * the stack however many segments it was drawn from.
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
  const { target, refuse } = useRasterTarget()

  let stroke: Stroke | null = null

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
    s.surface = surfaceHolding(
      s.surface,
      segmentWindow(s.from, at, shape.radius),
      s.pageW,
      s.pageH,
    )
    const region = s.surface.region
    if (isEmptyRect(region)) {
      s.from = at
      return
    }
    // Always the painting direction: this is coverage, and the eraser's coverage
    // is laid down exactly like the brush's. The operator is the commit's.
    const local = strokeMask(
      s.surface.coverage,
      region.w,
      region.h,
      { x: s.from.x - region.x, y: s.from.y - region.y },
      { x: at.x - region.x, y: at.y - region.y },
      shape,
      'paint',
    )
    s.from = at
    if (isEmptyRect(local)) return
    const segment = {
      x: local.x + region.x,
      y: local.y + region.y,
      w: local.w,
      h: local.h,
    }
    s.dirty = unionRect(s.dirty, segment)
    show(s, segment)
  }

  /**
   * The coverage the engine is to be handed over `at`, cut to the selection.
   *
   * One function for the previews and for the commit, because a preview that
   * was cut differently from the write it is standing in for would be showing
   * something the release then takes away.
   */
  function coverageFor(s: Stroke, at: Rect): Uint8Array {
    const coverage = coverageWithin(s.surface, at)
    const within = clampToPage(at, s.pageW, s.pageH)
    const mask = isEmptyRect(within) ? null : selection.maskPatchOf(s.page, within)
    if (mask !== null) cutToMask(coverage, at, mask, within)
    return coverage
  }

  /**
   * Shows the stroke as it stands, over the segment just drawn.
   *
   * The layer's own canvas is what this lands on, so the stack composites the
   * preview with the layer's opacity and blend mode without either being said
   * twice. Nothing is committed: the tiles and the frame the engine holds are
   * untouched all the way to the release, and no record is filed.
   *
   * No rectangle is worked out here beyond the segment that was just drawn. The
   * frame a preview stands on and how much of the layer has to come back with
   * it are the engine's answers, arrived at by the arithmetic the release will
   * use — which is what stops the two of them from landing apart.
   */
  function show(s: Stroke, segment: Rect): void {
    if (!raster.holds(s.entry.id) || isEmptyRect(segment)) return
    const shown = ask(s, segment)
    // Nothing covered, once the selection had cut it. Not a failure and not
    // something to show.
    if (shown === null) return
    /*
     * Nothing painted means the frame moved, and the answer is the frame alone.
     * The picture it is measured against is about to be rebuilt from nothing,
     * so what is wanted is the whole of it — and the whole of it holds more
     * than this segment drew, since everything earlier in the stroke is
     * uncommitted and lives nowhere but on the picture being replaced. So it is
     * asked again, over the frame the engine named, with everything the stroke
     * has laid down so far.
     */
    if (!isEmptyRect(shown.changed)) {
      raster.paste(s.entry.id, shown, true)
      return
    }
    const whole = ask(s, shown.frame)
    if (whole !== null) raster.paste(s.entry.id, whole, true)
  }

  /** What the layer would look like over `at`, with the stroke laid on it. */
  function ask(s: Stroke, at: Rect): EngineLayerPixels | null {
    const coverage = coverageFor(s, at)
    return s.mode === 'erase'
      ? window.engine.rasterPreviewErase(s.entry.id, coverage, at)
      : window.engine.rasterPreviewFill(
          s.entry.id,
          coverage,
          at,
          editor.foreground,
          s.entry.alphaLocked,
        )
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
    const opened: Stroke = {
      page,
      pageW: file.page.width,
      pageH: file.page.height,
      entry,
      mode,
      from: at,
      surface: EMPTY_SURFACE,
      dirty: EMPTY_RECT,
      taken,
    }
    stroke = opened
    // Nothing can be shown until the layer is over there. A press held still on
    // a layer being taken over would otherwise sit blank until it moved, so the
    // handover landing is itself a reason to draw.
    void taken.then(() => {
      if (stroke !== opened) return
      window.engine.rasterPreviewBegin(opened.entry.id)
      show(opened, opened.dirty)
    })
    strokeTo(at)
    return true
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
    if (stroke === null) return false
    void endStroke()
    return true
  }

  async function endStroke(): Promise<void> {
    const s = stroke
    stroke = null
    /*
     * A press that drew nothing — a brush sized to nothing, a click out past
     * the page — is not a step. Nothing has been handed to the engine yet, so
     * there is nothing to take back either.
     */
    if (s === null || isEmptyRect(s.dirty)) return

    const at = s.dirty
    // Outside a selection the stroke is cut to nothing, so neither the pixels
    // nor the frame can grow past it: a covered pixel is the only kind the
    // engine writes or measures a frame from.
    const coverage = coverageFor(s, at)

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
        : window.engine.rasterFill(
            s.entry.id,
            coverage,
            at,
            editor.foreground,
            s.entry.alphaLocked,
          )
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
