<template>
  <canvas
    v-if="sample"
    ref="canvasEl"
    v-bind="$attrs"
    class="pointer-events-none absolute select-none"
    :style="boxStyle"
  />
  <span
    v-else-if="failure"
    v-bind="$attrs"
    class="pointer-events-none absolute rounded-sm bg-background/80 px-1 text-xs whitespace-nowrap text-destructive ring-1 ring-destructive/40 select-none"
    :style="chipStyle"
  >
    無法繪製
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import { centeredBoxOnScreen, smoothingQualityFor, type ViewTransform } from '@/lib/coords'
import { labelBoxSize } from '@/lib/labelBox'
import { rasterFor } from '@/lib/labelRaster'
import { sampleSource } from '@/lib/fontSampleCache'

/**
 * One label's text, typeset by the engine and placed in screen coordinates.
 *
 * Deliberately not a child of the stage that carries the view's CSS transform.
 * A canvas under a CSS transform is resampled in one bilinear step with no
 * prefilter, which at the scales this application spends its time in does not
 * blur hairlines so much as delete them. Owning the downsample means owning
 * `imageSmoothingQuality`, which keeps them.
 *
 * Transparent to the pointer: the frame drawn over it is the one hit target
 * this object has, so that an empty label — which has no bitmap and so nothing
 * here to hit — is grabbed exactly the same way as one with text in it.
 */
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  text: string
  /** Already resolved down the default → group → override chain. */
  textStyle: TextStyle
  /** Label anchor, in page pixels. */
  x: number
  y: number
  /** The object's own turn on the page, in radians. */
  rotation: number
  view: ViewTransform
}>()

const dpr = window.devicePixelRatio || 1

const raster = computed(() => rasterFor(props.text, props.textStyle))
const sample = computed(() => (raster.value.ok ? raster.value.sample : null))
const failure = computed(() => (raster.value.ok ? '' : raster.value.reason))

const box = computed(() => {
  const size = labelBoxSize(props.textStyle, sample.value?.image ?? null)
  return centeredBoxOnScreen({ x: props.x, y: props.y }, size, props.view)
})

/**
 * The object's turn and the view's compose into one CSS rotation, which
 * resamples what we already resampled. Baking it into the drawImage below would
 * cost one pass instead of two, at the price of a bounding box that is the
 * rotated run's enclosing rectangle rather than the run itself — and the frame
 * around this would have to grow to match, so what you grab would stop being
 * the object. Upright, `rotate(0rad)` is the identity and costs nothing.
 */
const placement = computed(
  () => `translate(-50%, -50%) rotate(${props.view.rotate + props.rotation}rad)`,
)

const boxStyle = computed(() => ({
  left: `${box.value.centerX}px`,
  top: `${box.value.centerY}px`,
  width: `${box.value.width}px`,
  height: `${box.value.height}px`,
  transform: placement.value,
}))

const chipStyle = computed(() => ({
  left: `${box.value.centerX}px`,
  top: `${box.value.centerY}px`,
  transform: placement.value,
}))

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')

function paint() {
  const el = canvasEl.value
  const held = sample.value
  if (!el || !held) return

  const w = Math.max(1, Math.round(box.value.width * dpr))
  const h = Math.max(1, Math.round(box.value.height * dpr))
  // Assigning either one blanks the canvas, so they are only touched when the
  // size actually moved — a pan repaints nothing.
  if (el.width !== w || el.height !== h) {
    el.width = w
    el.height = h
  }

  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, w, h)
  // Device pixels per bitmap pixel. Matching the page underneath: filtered
  // while there is detail to lose, nearest neighbour past 3x where the point
  // is to see the pixel grid, and the expensive filter only where it pays —
  // going down. This is also where renderScale becomes visible.
  const ratio = (props.view.scale * dpr) / props.textStyle.renderScale
  ctx.imageSmoothingEnabled = ratio < 3
  ctx.imageSmoothingQuality = smoothingQualityFor(ratio)
  ctx.drawImage(sampleSource(held), 0, 0, w, h)
}

onMounted(paint)
// Post-flush: the element has to exist and carry its new size attributes
// before there is anything to draw into.
watch([sample, () => box.value.width, () => box.value.height], paint, { flush: 'post' })
</script>
