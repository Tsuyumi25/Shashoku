<template>
  <canvas ref="canvasEl" class="pointer-events-none absolute inset-0 h-full w-full" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue'
import type { TextLayerEntry } from '@shared/page/types'
import { textOf } from '@shared/page/text'
import { applyViewTransform, type ViewTransform } from '@/lib/coords'
import { sampleSource } from '@/lib/fontSampleCache'
import { drawnLabel, type DrawnLabel } from '@/lib/labelRaster'
import { applyPlacement, type LayerPlacement } from '@/lib/layerTransform'
import type { RasterStackNode } from '@shared/page/stack'
import type { RunStackNode } from '@/lib/stackSegments'

/**
 * A run of the page's objects on one canvas, drawn in page coordinates under
 * the view's own transform — the same path the raw page underneath takes, so
 * the two cannot come out at different scales or drift apart when the view
 * turns.
 *
 * Sharing a canvas is what makes this affordable. One viewport-sized backing
 * store at a retina scale is tens of megabytes; `stackSegments` decides which
 * objects may share, and everything that blends normally does.
 *
 * Rasters and text differ here only in where the bitmap comes from and who
 * closes it. Everything after that — placement, alpha, filtering — is the same
 * for both, which is the point: two draw paths would be two answers to what
 * this page looks like.
 */
const props = defineProps<{
  nodes: readonly RunStackNode[]
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
 *
 * Text needs none of this. Its bitmaps come from the sample cache, which is
 * keyed on what was asked for rather than on who asked, and nothing here owns
 * them.
 */
const bitmaps = shallowRef<Map<string, ImageBitmap>>(new Map())

function releaseAll() {
  for (const bitmap of bitmaps.value.values()) bitmap.close()
  bitmaps.value = new Map()
}

function isRaster(node: RunStackNode): node is RasterStackNode {
  return node.kind === 'raster'
}

/** A layer with no frame yet has nothing to draw and no file worth reading. */
function drawable(node: RasterStackNode): boolean {
  return node.entry.w > 0 && node.entry.h > 0
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

let loadToken = 0

async function loadBitmaps() {
  const token = ++loadToken
  const wanted = [...new Set(props.nodes.filter(isRaster).filter(drawable).map((n) => n.entry.file))]
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
    // Only a run of normally-blending objects shares a canvas, so drawing each
    // at its own alpha over the last is the same picture CSS would make of
    // them one at a time.
    ctx.globalAlpha = node.opacity
    if (node.kind === 'text') {
      drawText(ctx, node.entry)
      continue
    }
    if (!drawable(node)) continue
    const bitmap = bitmaps.value.get(node.entry.file)
    if (!bitmap) continue
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
  () => [props.layersDir, props.nodes.filter(isRaster).map((n) => n.entry.file).join(' ')] as const,
  loadBitmaps,
  { immediate: true },
)

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

watch(() => [props.view, props.container, props.place] as const, schedulePaint, { deep: true })

onBeforeUnmount(releaseAll)
</script>
