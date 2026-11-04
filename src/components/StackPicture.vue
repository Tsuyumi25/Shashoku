<template>
  <canvas ref="canvasEl" class="pointer-events-none absolute inset-0 h-full w-full" />
</template>

<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import { useDevicePixelRatio } from '@vueuse/core'
import { stackedRasterNodes, type BufferStackNode } from '@shared/page/stack'
import type { TextLayerEntry } from '@shared/page/types'
import { useCanvasLabel } from '@/composables/useCanvasLabel'
import type { LayerBitmaps } from '@/composables/useLayerBitmaps'
import { applyViewTransform, type ViewTransform } from '@/lib/coords'
import { sampleSource } from '@/lib/fontSampleCache'
import type { EffectedLayer } from '@/lib/layerEffects'
import { pictureWithEffects } from '@/lib/layerEffects'
import type { LayerPlacement } from '@/lib/layerTransform'
import { context2d, drawStack } from '@/lib/pageComposite'
import { useRasterStore } from '@/stores/rasterStore'
import { useStrokeOverlayStore } from '@/stores/strokeOverlayStore'

/**
 * A folder whose effects are grown from its contents, drawn as the one picture
 * those contents make.
 *
 * Built by `drawStack`, the same code the export runs, so the outline on screen
 * is the outline in the file. What the canvas has and the export does not — a
 * layer under a gesture, a stroke still in the hand — is handed to it, so the
 * outline follows a member while it moves.
 */
const props = defineProps<{
  node: BufferStackNode
  bitmaps: LayerBitmaps
  container: { w: number; h: number }
  view: ViewTransform
  /** The page's own size, which a folder's buffer is. */
  page: { w: number; h: number }
  held?: { id: string; place: LayerPlacement } | null
  /** For each text object, the ones under it its stroke stays off. See `joinedBelow`. */
  joined: ReadonlyMap<string, readonly TextLayerEntry[]>
}>()

const { pixelRatio } = useDevicePixelRatio()
const raster = useRasterStore()
const stroke = useStrokeOverlayStore()
const labels = useCanvasLabel()

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')

const members = computed(() => new Set(stackedRasterNodes(props.node.children).map((n) => n.entry.id)))

/**
 * The cache. A band costs a distance field over everything the folder covers,
 * and a repaint happens on every pan and zoom — so only what the picture is
 * made of is tracked here, and a brush on a layer outside the folder is not.
 */
const picture = computed<EffectedLayer>(() => {
  void props.bitmaps.revision.value
  for (const id of members.value) {
    void raster.liveLayer(id)
    void raster.writesTo(id)
  }
  const drawing = stroke.layerId !== null && members.value.has(stroke.layerId)
  if (drawing) void stroke.revision
  const held = props.held && members.value.has(props.held.id) ? props.held : null

  const { w, h } = props.page
  const buffer = new OffscreenCanvas(w, h)
  drawStack(context2d(buffer), props.node.children, {
    page: props.page,
    rasters: props.bitmaps,
    liveLayer: (id) => raster.liveLayer(id),
    place: (id) => (held?.id === id ? held.place : undefined),
    overlay: (id) => (drawing ? stroke.overlayFor(id) : null),
    drawText: (ctx, node) => {
      const drawn = labels.labelOf(node.entry)
      if (!drawn.sample) return
      const under = props.joined.get(node.entry.id)
      const picture = (under && labels.joinedOf(node.entry, under)) ?? sampleSource(drawn.sample)
      const { width, height } = drawn.sample.image
      ctx.drawImage(picture, drawn.center.x - width / 2, drawn.center.y - height / 2)
    },
  })
  return pictureWithEffects(buffer, props.node.entry.effects) ?? { canvas: buffer, frame: { x: 0, y: 0, w, h } }
})

function paint() {
  const cv = canvasEl.value
  const ctx = cv?.getContext('2d')
  if (!cv || !ctx) return
  if (frame !== null) {
    cancelAnimationFrame(frame)
    frame = null
  }
  const dpr = pixelRatio.value
  const w = Math.max(1, Math.round(props.container.w * dpr))
  const h = Math.max(1, Math.round(props.container.h * dpr))
  if (cv.width !== w || cv.height !== h) {
    cv.width = w
    cv.height = h
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cv.width, cv.height)
  applyViewTransform(ctx, props.view, dpr)
  const { canvas, frame: at } = picture.value
  ctx.drawImage(canvas, at.x, at.y, at.w, at.h)
}

let frame: number | null = null
function schedulePaint() {
  if (frame !== null) return
  frame = requestAnimationFrame(() => {
    frame = null
    paint()
  })
}

watch(picture, schedulePaint)
watch(() => [props.view, props.container, pixelRatio.value] as const, schedulePaint, { deep: true })
onMounted(paint)
</script>
