<template>
  <canvas ref="canvasEl" class="pointer-events-none absolute inset-0 h-full w-full" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import type { RasterStackNode } from '@shared/page/stack'
import { applyViewTransform, type ViewTransform } from '@/lib/coords'
import { applyPlacement, type LayerPlacement } from '@/lib/layerTransform'

/**
 * A run of raster layers on one canvas, drawn in page coordinates under the
 * view's own transform — the same path the raw page underneath takes, so the
 * two cannot come out at different scales or drift apart when the view turns.
 *
 * Sharing a canvas is what makes this affordable. One viewport-sized backing
 * store at a retina scale is tens of megabytes, and a page erased one region at
 * a time carries twenty layers; `stackSegments` decides which of them may share.
 */
const props = defineProps<{
  nodes: readonly RasterStackNode[]
  /** Where this page's layer files live. */
  layersDir: string
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
}>()

const dpr = window.devicePixelRatio || 1

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')

/**
 * Held for as long as this run is mounted and closed with it. Turning the page
 * unmounts every run on it, which is the whole of the eviction policy: a
 * decoded layer costs its frame in bytes, and holding a chapter's worth would
 * be the full-page-buffer bill the layer frame exists to avoid.
 */
const bitmaps = shallowRef<Map<string, ImageBitmap>>(new Map())

function releaseAll() {
  for (const bitmap of bitmaps.value.values()) bitmap.close()
  bitmaps.value = new Map()
}

/** A layer with no frame yet has nothing to draw and no file worth reading. */
function drawable(node: RasterStackNode): boolean {
  return node.entry.w > 0 && node.entry.h > 0
}

let loadToken = 0

async function loadBitmaps() {
  const token = ++loadToken
  const wanted = [...new Set(props.nodes.filter(drawable).map((n) => n.entry.file))]
  const next = new Map<string, ImageBitmap>()
  /** Only what this run decoded — what it reused is still owned by `bitmaps`. */
  const fresh: ImageBitmap[] = []

  const abandon = () => {
    for (const bitmap of fresh) bitmap.close()
  }

  for (const file of wanted) {
    const held = bitmaps.value.get(file)
    if (held) {
      next.set(file, held)
      continue
    }
    try {
      const bytes = await window.api.readImage(props.layersDir, file)
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
      if (token !== loadToken) {
        bitmap.close()
        return abandon()
      }
      fresh.push(bitmap)
      next.set(file, bitmap)
    } catch (err) {
      // The page is still worth looking at without one patch, and the manifest
      // is what says the patch should be there — this is not where that is
      // reported. Export refuses outright, which is where it matters.
      console.error('layer image unavailable', file, err)
    }
  }
  if (token !== loadToken) return abandon()

  for (const [file, bitmap] of bitmaps.value) if (next.get(file) !== bitmap) bitmap.close()
  bitmaps.value = next
  paint()
}

function paint() {
  const cv = canvasEl.value
  if (!cv) return
  const ctx = cv.getContext('2d')
  if (!ctx) return
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
    const bitmap = bitmaps.value.get(node.entry.file)
    if (!bitmap || !drawable(node)) continue
    // Only a run of normally-blending layers shares a canvas, so drawing each
    // at its own alpha over the last is the same picture CSS would make of
    // them one at a time.
    ctx.globalAlpha = node.opacity
    const { x, y, w: fw, h: fh } = node.entry
    if (props.place) {
      // Around the layer's own middle, and undone afterwards so a preview can
      // never leak onto whatever else this canvas holds.
      ctx.save()
      applyPlacement(ctx, node.entry, props.place, { x: 0, y: 0 })
      ctx.drawImage(bitmap, 0, 0, fw, fh)
      ctx.restore()
      continue
    }
    ctx.drawImage(bitmap, x, y, fw, fh)
  }
  ctx.globalAlpha = 1
}

let scheduled = false
function schedulePaint() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    paint()
  })
}

watch(
  () => [props.layersDir, props.nodes.map((n) => n.entry.file).join(' ')] as const,
  loadBitmaps,
  { immediate: true },
)

/**
 * Everything this canvas draws with, read field by field so each one is
 * tracked. `pageStack` never looks at a frame, so a layer moved or grown hands
 * back the very same node and nothing above here would say it had changed.
 */
watch(
  () =>
    props.nodes
      .map((n) => `${n.entry.x},${n.entry.y},${n.entry.w},${n.entry.h},${n.opacity}`)
      .join('|'),
  schedulePaint,
)

watch(() => [props.view, props.container, props.place] as const, schedulePaint, { deep: true })

onBeforeUnmount(releaseAll)
</script>
