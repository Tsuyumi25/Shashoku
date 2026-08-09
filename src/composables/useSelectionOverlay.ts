import { onBeforeUnmount, watch, type Ref } from 'vue'
import { applyViewTransform } from '@/lib/coords'
import {
  ANTS_DASH,
  antsPath,
  openPath,
  paintMaskRegion,
  strokeAnts,
  strokeBuildingPath,
} from '@/lib/selection/overlay'
import { useEditorStore } from '@/stores/editorStore'
import { useSelectionStore } from '@/stores/selectionStore'

/** A crawl reads as a crawl at about twelve steps a second, and no faster. */
const ANTS_FRAME_MS = 80

/**
 * Past this many vertices the ants are drawn still. A selection painted by hand
 * can have tens of thousands of separate specks, and animating that spends the
 * whole frame budget on a shimmer nobody can follow anyway.
 */
const ANTS_ANIMATION_LIMIT = 50_000

/**
 * What one frame of the overlay is made of, worked out when the selection or the
 * view moves and then drawn as often as the crawl asks for.
 *
 * The crawl only changes a dash offset, so it must not be the thing that decides
 * what is on the layer — everything here is redrawn together, or animating the
 * ants would rub out whatever else the frame had in it.
 */
interface OverlayFrame {
  /** Page-sized and in page coordinates, so it lands at the page origin. */
  wash: OffscreenCanvas | null
  ants: Path2D | null
  shape: Path2D | null
  building: Path2D | null
  vertices: number
}

const EMPTY_FRAME: OverlayFrame = { wash: null, ants: null, shape: null, building: null, vertices: 0 }

/**
 * The layer over the page that says what is selected.
 *
 * The committed selection is shown one way or the other, never both: marching
 * ants and Quick Mask are two readings of one mask, and drawing them together
 * leaves the outline buried in its own wash. What a gesture is describing right
 * now is a separate matter and goes on top of either — Photoshop and GIMP both
 * show the marquee you are dragging while a mask is on screen, and without it a
 * drag in Quick Mask shows its effect and never its boundary.
 *
 * Everything here shares `applyViewTransform` with the page below, so the two
 * never disagree about where a page pixel is.
 */
export function useSelectionOverlay(canvas: Ref<HTMLCanvasElement | null>, ready: () => boolean) {
  const editor = useEditorStore()
  const selection = useSelectionStore()
  const view = editor.view

  let frame = EMPTY_FRAME
  let phase = 0
  let lastCrawlAt = 0
  let crawlRaf = 0
  let paintScheduled = false

  /**
   * The wash lives at page size and is kept between frames, so a brush stamp
   * repaints the few thousand pixels it dirtied instead of the whole selection.
   *
   * `washMask` is held to compare by identity rather than to read: a gesture in
   * progress is shown from a scratch buffer, and patching one from the other's
   * regions would paint the wrong pixels. Anything but the same array on the
   * same page falls back to a full repaint.
   */
  let washImage: OffscreenCanvas | null = null
  let washCtx: OffscreenCanvasRenderingContext2D | null = null
  let washMask: Uint8ClampedArray | null = null
  let washAt = -1

  function stopCrawl(): void {
    if (crawlRaf) cancelAnimationFrame(crawlRaf)
    crawlRaf = 0
  }

  function build(): OverlayFrame {
    const page = editor.currentPageId
    if (page === null || !ready()) return EMPTY_FRAME
    const dpr = window.devicePixelRatio || 1

    const shown = selection.displayFor(page)
    let wash: OverlayFrame['wash'] = null
    let ants: Path2D | null = null
    let vertices = 0

    if (shown !== null && shown.bounds !== null) {
      if (selection.quickMask) {
        // The mask only changes when the revision does, so a still selection is
        // drawn from an image built once however much the view moves over it.
        if (washImage === null || washImage.width !== shown.w || washImage.height !== shown.h) {
          washImage = new OffscreenCanvas(shown.w, shown.h)
          washCtx = washImage.getContext('2d')
          washMask = null
        }
        if (washCtx !== null && washAt !== selection.revision) {
          const patch = washMask === shown.mask ? selection.dirtySince(washAt) : null
          if (patch === null) {
            washCtx.clearRect(0, 0, shown.w, shown.h)
            paintMaskRegion(washCtx, shown.mask, shown.w, shown.bounds)
          } else {
            paintMaskRegion(washCtx, shown.mask, shown.w, patch)
          }
          washMask = shown.mask
          washAt = selection.revision
        }
        if (washCtx !== null) wash = washImage
      } else {
        const loops = selection.outlinesFor(page)
        if (loops.length > 0) {
          ants = antsPath(loops, view, dpr)
          for (const loop of loops) vertices += loop.length
        }
      }
    }

    const shapeLoops = selection.shapeOutlinesFor(page)
    let shape: Path2D | null = null
    if (shapeLoops.length > 0) {
      shape = antsPath(shapeLoops, view, dpr)
      for (const loop of shapeLoops) vertices += loop.length
    }

    const placed = selection.buildingPathFor(page)
    const building = placed.length > 1 ? openPath(placed, view, dpr) : null

    return { wash, ants, shape, building, vertices }
  }

  function render(): void {
    const cv = canvas.value
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(editor.viewContainerSize.w * dpr))
    const h = Math.max(1, Math.round(editor.viewContainerSize.h * dpr))
    // Remounting skips a resize callback, so the backing store is sized here.
    if (cv.width !== w || cv.height !== h) {
      cv.width = w
      cv.height = h
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)

    if (frame.wash !== null) {
      applyViewTransform(ctx, view, dpr)
      ctx.drawImage(frame.wash, 0, 0)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }
    if (frame.ants !== null) strokeAnts(ctx, frame.ants, phase)
    if (frame.shape !== null) strokeAnts(ctx, frame.shape, phase)
    if (frame.building !== null) strokeBuildingPath(ctx, frame.building)
  }

  function crawl(now: number): void {
    crawlRaf = requestAnimationFrame(crawl)
    if (now - lastCrawlAt < ANTS_FRAME_MS) return
    lastCrawlAt = now
    phase = (phase + 1) % (ANTS_DASH * 2)
    render()
  }

  function paint(): void {
    stopCrawl()
    frame = build()
    render()
    const dashed = frame.ants !== null || frame.shape !== null
    if (dashed && frame.vertices <= ANTS_ANIMATION_LIMIT) crawlRaf = requestAnimationFrame(crawl)
  }

  function schedulePaint(): void {
    if (paintScheduled) return
    paintScheduled = true
    requestAnimationFrame(() => {
      paintScheduled = false
      paint()
    })
  }

  watch(view, schedulePaint)
  watch(() => selection.revision, schedulePaint)
  watch(() => selection.quickMask, schedulePaint)
  watch(() => editor.currentPageId, schedulePaint)

  onBeforeUnmount(stopCrawl)

  return { schedulePaint }
}
