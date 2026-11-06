import { onBeforeUnmount, watch, type Ref } from 'vue'
import { applyViewTransform } from '@/lib/coords'
import { paintPieces, type Piece } from '@/lib/explode/pieces'
import {
  ANTS_PHASES,
  antsTile,
  openPath,
  paintMaskRegion,
  strokeBuildingPath,
  strokeSegments,
} from '@/lib/selection/overlay'
import { intersectRect, sameRect, type Point, type Rect } from '@/lib/selection/rect'
import { useEditorStore } from '@/stores/editorStore'
import { useExplodeStore } from '@/stores/explodeStore'
import { useSelectionStore } from '@/stores/selectionStore'

/** A crawl reads as a crawl at about twelve steps a second, and no faster. */
const ANTS_FRAME_MS = 80

/**
 * What one frame of the overlay is made of, worked out when the selection or the
 * view moves and then drawn as often as the crawl asks for.
 *
 * The crawl only changes which stripes show through the ants mask, so it must
 * not be the thing that decides what is on the layer — everything here is
 * redrawn together, or animating the ants would rub out whatever else the frame
 * had in it.
 */
interface OverlayFrame {
  /** Page-sized and in page coordinates, so it lands at the page origin. */
  wash: OffscreenCanvas | null
  /** Whether the ants mask has anything in it this frame. */
  ants: boolean
  /** The shape a gesture is building, in page pixels. */
  building: readonly Point[] | null
  pieces: readonly Piece[] | null
}

const EMPTY_FRAME: OverlayFrame = { wash: null, ants: false, building: null, pieces: null }

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
  const explode = useExplodeStore()
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
   * `washRegion` says which part of the page the last frame's bytes were of. A
   * patch is only safe when this frame is a window on the same rectangle: the
   * dirty log is in page coordinates and the bytes are not, so a window that
   * moved would have the patch read from the wrong offset.
   */
  let washImage: OffscreenCanvas | null = null
  let washCtx: OffscreenCanvasRenderingContext2D | null = null
  let washRegion: Rect | null = null
  let washAt = -1

  /**
   * The ants are a mask and a pattern. Every boundary segment — of the selection
   * and of the shape being dragged — is stroked once into `antsMask`, at screen
   * size and in device pixels; each crawl step fills `antsLayer` with the
   * stripes for its phase and keeps only what the mask covers. A frame's cost is
   * the size of the screen, however many specks a screentone selection has.
   */
  let antsMask: OffscreenCanvas | null = null
  let antsLayer: OffscreenCanvas | null = null
  let tiles: OffscreenCanvas[] | null = null

  function screenCanvas(at: OffscreenCanvas | null, w: number, h: number): OffscreenCanvas {
    if (at !== null && at.width === w && at.height === h) return at
    return new OffscreenCanvas(w, h)
  }

  function stopCrawl(): void {
    if (crawlRaf) cancelAnimationFrame(crawlRaf)
    crawlRaf = 0
  }

  function build(): OverlayFrame {
    const page = editor.currentPageId
    if (page === null || !ready()) return EMPTY_FRAME
    const dpr = window.devicePixelRatio || 1
    const pieces = explode.piecesOf(view)

    const shown = selection.displayFor(page)
    let wash: OverlayFrame['wash'] = null
    const segments: Int32Array[] = []

    if (shown !== null && shown.bounds !== null) {
      if (selection.quickMask) {
        // The mask only changes when the revision does, so a still selection is
        // drawn from an image built once however much the view moves over it.
        const size = editor.viewContentSize
        if (washImage === null || washImage.width !== size.w || washImage.height !== size.h) {
          washImage = new OffscreenCanvas(Math.max(1, size.w), Math.max(1, size.h))
          washCtx = washImage.getContext('2d')
          washRegion = null
        }
        if (washCtx !== null && washAt !== selection.revision) {
          const patch =
            washRegion !== null && sameRect(washRegion, shown.region)
              ? selection.dirtySince(washAt)
              : null
          if (patch === null) {
            washCtx.clearRect(0, 0, washImage.width, washImage.height)
            paintMaskRegion(washCtx, shown, shown.region)
          } else {
            paintMaskRegion(washCtx, shown, intersectRect(patch, shown.region))
          }
          washRegion = shown.region
          washAt = selection.revision
        }
        if (washCtx !== null) wash = washImage
      } else {
        segments.push(selection.outlinesFor(page))
      }
    }
    segments.push(selection.shapeOutlinesFor(page))

    const ants = segments.some((s) => s.length > 0)
    if (ants) {
      const w = Math.max(1, Math.round(editor.viewContainerSize.w * dpr))
      const h = Math.max(1, Math.round(editor.viewContainerSize.h * dpr))
      antsMask = screenCanvas(antsMask, w, h)
      antsLayer = screenCanvas(antsLayer, w, h)
      const mask = antsMask.getContext('2d')
      if (mask !== null) {
        mask.clearRect(0, 0, w, h)
        paintPieces(mask, view, pieces, dpr, (at) => {
          mask.setTransform(1, 0, 0, 1, 0, 0)
          for (const s of segments) if (s.length > 0) strokeSegments(mask, s, at, dpr)
        })
      }
    }

    const placed = selection.buildingPathFor(page)
    const building = placed.length > 1 ? placed : null

    return { wash, ants, building, pieces }
  }

  /** The stripes for this phase, kept to where the mask has a boundary. */
  function drawAnts(ctx: CanvasRenderingContext2D): void {
    if (antsMask === null || antsLayer === null) return
    const layer = antsLayer.getContext('2d')
    if (layer === null) return
    tiles ??= Array.from({ length: ANTS_PHASES }, (_, i) => antsTile(i))
    const pattern = layer.createPattern(tiles[phase], 'repeat')
    if (pattern === null) return
    layer.globalCompositeOperation = 'copy'
    layer.fillStyle = pattern
    layer.fillRect(0, 0, antsLayer.width, antsLayer.height)
    layer.globalCompositeOperation = 'destination-in'
    layer.drawImage(antsMask, 0, 0)
    layer.globalCompositeOperation = 'source-over'
    ctx.drawImage(antsLayer, 0, 0)
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

    const { wash, building, pieces } = frame
    if (wash !== null) {
      paintPieces(ctx, view, pieces, dpr, (at) => {
        applyViewTransform(ctx, at, dpr)
        ctx.drawImage(wash, 0, 0)
      })
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    }
    if (frame.ants) drawAnts(ctx)
    if (building !== null) {
      paintPieces(ctx, view, pieces, dpr, (at) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        strokeBuildingPath(ctx, openPath(building, at, dpr))
      })
    }
  }

  function crawl(now: number): void {
    crawlRaf = requestAnimationFrame(crawl)
    if (now - lastCrawlAt < ANTS_FRAME_MS) return
    lastCrawlAt = now
    phase = (phase + 1) % ANTS_PHASES
    render()
  }

  function paint(): void {
    stopCrawl()
    frame = build()
    render()
    if (frame.ants) crawlRaf = requestAnimationFrame(crawl)
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
  watch(() => explode.piecesOf(view), schedulePaint)
  watch(() => selection.revision, schedulePaint)
  watch(() => selection.quickMask, schedulePaint)
  watch(() => editor.currentPageId, schedulePaint)

  onBeforeUnmount(stopCrawl)

  return { schedulePaint }
}
