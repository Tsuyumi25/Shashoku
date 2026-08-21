<template>
  <canvas ref="canvasEl" class="pointer-events-none absolute inset-0 h-full w-full" />
</template>

<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import type { TextLayerEntry } from '@shared/page/types'
import { textOf } from '@shared/page/text'
import type { LayerBitmaps } from '@/composables/useLayerBitmaps'
import { applyViewTransform, type ViewTransform } from '@/lib/coords'
import { sampleSource } from '@/lib/fontSampleCache'
import { drawnLabel, type DrawnLabel } from '@/lib/labelRaster'
import { applyPlacement, type LayerPlacement } from '@/lib/layerTransform'
import type { RasterStackNode } from '@shared/page/stack'
import type { RunStackNode } from '@/lib/stackSegments'
import { useRasterStore } from '@/stores/rasterStore'
import { useStrokeOverlayStore, type StrokeOverlay } from '@/stores/strokeOverlayStore'

/**
 * A run of the page's objects on one canvas, drawn in page coordinates under
 * the view's own transform — the same path every other run takes, so no two of
 * them can come out at different scales or drift apart when the view turns.
 *
 * Sharing a canvas is what makes this affordable. One viewport-sized backing
 * store at a retina scale is tens of megabytes; `stackSegments` decides which
 * objects may share, and everything that blends normally does.
 *
 * Rasters and text differ here only in where the bitmap comes from — the page's
 * layer cache for one, the font sample cache for the other, and neither of them
 * this run's to own. Everything after that — placement, alpha, filtering — is
 * the same for both, which is the point: two draw paths would be two answers to
 * what this page looks like.
 */
const props = defineProps<{
  nodes: readonly RunStackNode[]
  /**
   * The page's decoded layers, which this run reads and does not own. Runs are
   * made and unmade every time the stack is re-cut, and a run that owned its
   * decodes would take them with it.
   */
  bitmaps: LayerBitmaps
  container: { w: number; h: number }
  view: ViewTransform
  /**
   * A gesture in progress, in page units and deliberately fractional — this is
   * the preview, and the layer's own whole-pixel frame is left alone until the
   * release resamples it. `stackSegments` has given the layer this canvas to
   * itself, so the transform can be applied to the whole of it.
   *
   * Redrawn rather than transformed in CSS: this canvas holds only what fell
   * inside the viewport, so moving the element would drag its own empty edge
   * into view along with the layer.
   */
  place?: LayerPlacement
  /**
   * The stroke being drawn on this run's layer, which `PageStack` only hands
   * over when that layer is alone here. Alone is what makes it drawable: an
   * eraser takes alpha out of this canvas, and a neighbour sharing it would
   * have a hole punched through it too.
   *
   * A prop lags: it is settled when the run renders, and a stroke can be taken
   * down inside the very write that repaints — so what is drawn is checked
   * against the overlay as it stands now rather than as it stood then.
   */
  overlay?: StrokeOverlay
}>()

const dpr = window.devicePixelRatio || 1

const raster = useRasterStore()
const stroke = useStrokeOverlayStore()

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')

/**
 * One raster layer, or nothing when it has no pixels to put anywhere yet.
 *
 * A layer the engine holds draws from the canvas its patches are pasted into,
 * not from the file — the file is one write behind for as long as an edit is
 * being made, and that canvas is what an edit changes. Its frame comes from
 * there too, because the manifest is not told a layer grew until the file
 * naming the new frame is safely on disk. Which is also why the frame decides
 * whether there is anything to draw: the manifest's is still the frame from
 * before the edit, and on a layer first painted this session that is nothing.
 */
function drawRaster(ctx: CanvasRenderingContext2D, node: RasterStackNode): void {
  const live = raster.liveLayer(node.entry.id)
  const source = live?.canvas ?? props.bitmaps.get(node.entry.file)
  if (!source) return
  const { x, y, w: fw, h: fh } = live?.frame ?? node.entry
  if (fw <= 0 || fh <= 0) return
  if (props.place) {
    // Around the layer's own middle, and undone afterwards so a preview can
    // never leak onto whatever else this canvas holds.
    ctx.save()
    applyPlacement(ctx, node.entry, props.place, { x: 0, y: 0 })
    ctx.drawImage(source, 0, 0, fw, fh)
    ctx.restore()
    return
  }
  ctx.drawImage(source, x, y, fw, fh)
}

/**
 * Every text object in this run, already typeset.
 *
 * A computed rather than work done inside `paint`, because `drawnLabel` reads
 * the font catalogue — module state that is reactive. Called from a plain
 * function nothing would track it, and the page would stay blank until some
 * unrelated change happened to repaint it after the catalogue finished loading.
 */
const drawnTexts = computed(() => {
  const out = new Map<string, DrawnLabel>()
  for (const node of props.nodes) {
    if (node.kind !== 'text') continue
    const entry = node.entry
    out.set(
      entry.id,
      drawnLabel(textOf(entry), entry.style, { x: entry.x, y: entry.y }, entry.rotation),
    )
  }
  return out
})

function paint() {
  const cv = canvasEl.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
  // A painted canvas is current, so a frame waiting to paint it again has
  // nothing left to do. Cancelling here rather than at each caller is what lets
  // a write draw itself immediately without the stroke's pending frame then
  // drawing the same picture a second time. After the guards above, so a call
  // made before the canvas exists cannot swallow the frame that would have
  // drawn it.
  if (frame !== null) {
    cancelAnimationFrame(frame)
    frame = null
  }
  const w = Math.max(1, Math.round(props.container.w * dpr))
  const h = Math.max(1, Math.round(props.container.h * dpr))
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cv.width, cv.height)
  applyViewTransform(ctx, props.view, dpr)

  for (const node of props.nodes) {
    // Only a run of normally-blending objects shares a canvas, so drawing each
    // at its own alpha over the last is the same picture CSS would make of
    // them one at a time. A run carrying a stroke is the exception: its opacity
    // is on the element, because it belongs to the layer and the stroke as one.
    ctx.globalAlpha = props.overlay ? 1 : node.opacity
    if (node.kind === 'text') {
      drawText(ctx, node.entry)
      continue
    }
    drawRaster(ctx, node)
    /*
     * After the layer and before anything else, so the operator meets the
     * layer's own pixels — and whether the layer drew anything or not. A first
     * stroke on a layer with no frame yet is exactly the case where the layer
     * contributes nothing and the stroke is the whole of the picture.
     *
     * Straight back to source-over: this canvas is shared with whatever the
     * stack put on it either side of a stroke.
     */
    if (props.overlay && stroke.layerId === node.entry.id) {
      const { canvas, region, op } = props.overlay
      ctx.globalCompositeOperation = op
      ctx.drawImage(canvas, region.x, region.y, region.w, region.h)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
  ctx.globalAlpha = 1
}

/**
 * The centre and the bitmap the export draws from, taken from the one function
 * that decides them. Nothing about the corner or the phase is worked out again
 * here; doing so is how two surfaces come to disagree by half a pixel.
 *
 * No rotation: the engine turned the outline before rasterizing it, so the
 * bitmap already stands at the object's angle and lands one pixel per pixel.
 */
function drawText(ctx: CanvasRenderingContext2D, entry: TextLayerEntry) {
  const drawn = drawnTexts.value.get(entry.id)
  if (!drawn?.sample) return
  const { width, height } = drawn.sample.image
  ctx.save()
  ctx.translate(drawn.center.x, drawn.center.y)
  ctx.drawImage(sampleSource(drawn.sample), -width / 2, -height / 2)
  ctx.restore()
}

let frame: number | null = null
function schedulePaint() {
  if (frame !== null) return
  frame = requestAnimationFrame(() => {
    frame = null
    paint()
  })
}

/** A layer whose read has just landed is one this run may be the only drawer of. */
watch(() => props.bitmaps.revision.value, schedulePaint)

/**
 * Everything a raster draws with, read field by field so each one is tracked.
 * `pageStack` never looks at a frame, so a layer moved or grown hands back the
 * very same node and nothing above here would say it had changed.
 */
watch(
  () =>
    props.nodes
      .map((node) =>
        node.kind === 'raster'
          ? `${node.entry.x},${node.entry.y},${node.entry.w},${node.entry.h},${node.opacity}`
          : `t${node.entry.id},${node.entry.rotation},${node.opacity}`,
      )
      .join('|'),
  schedulePaint,
)

/** Typeset text already tracks its own inputs; this is only the repaint. */
watch(drawnTexts, schedulePaint)

/**
 * A write lands on screen in the same call stack that made it, rather than on
 * the next frame. Drawing is what says the write happened, so anything between
 * the two is a hand the picture is behind — and there is no version number to
 * reconcile because the act of painting is itself the signal.
 */
watch(() => raster.committed, paint, { flush: 'sync' })

/**
 * A stroke being shown is the other caller, and it is held to the next frame.
 *
 * The screen only changes on a frame, so a preview drawn on one is by
 * definition on time — while a pen reports two to eight times per frame, and
 * every one of those reports would otherwise clear this whole canvas and redraw
 * every object on it. The frame that a write cancels is this one.
 */
watch(() => raster.revision, schedulePaint, { flush: 'sync' })

/** The stroke on this run's layer, which moves for the same reason and as often. */
watch(() => stroke.revision, schedulePaint)

watch(() => [props.view, props.container, props.place] as const, schedulePaint, { deep: true })

/**
 * Nothing above draws a run that has just appeared: every watch here fires on a
 * change, and a fresh run has had none. Re-cutting the stack makes runs whose
 * objects and view are exactly what they were, so without this the page would
 * hold its breath until something unrelated moved.
 */
onMounted(paint)
</script>
