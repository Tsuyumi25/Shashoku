<template>
  <canvas
    v-if="sample"
    ref="canvasEl"
    v-bind="$attrs"
    class="absolute cursor-pointer select-none"
    :style="boxStyle"
    @click.stop="emit('select')"
  />
  <span
    v-else-if="failure"
    v-bind="$attrs"
    class="absolute cursor-pointer rounded-sm bg-background/80 px-1 text-xs whitespace-nowrap text-destructive ring-1 ring-destructive/40 select-none"
    :style="chipStyle"
    :title="failure"
    @click.stop="emit('select')"
  >
    無法繪製
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import { centeredBoxOnScreen, percentToContentPx, type ViewTransform } from '@/lib/coords'
import { catalogByFamily, catalogLoaded } from '@/lib/fontCatalog'
import { sampleFor, sampleSource, type Sample } from '@/lib/fontSampleCache'
import { engineStrokeFor } from '@/lib/textStyle'

/**
 * One label's text, typeset by the engine and placed in screen coordinates.
 *
 * Deliberately not a child of the stage that carries the view's CSS transform.
 * A canvas under a CSS transform is resampled in one bilinear step with no
 * prefilter, which at the scales this application spends its time in does not
 * blur hairlines so much as delete them. Owning the downsample means owning
 * `imageSmoothingQuality`, which keeps them.
 */
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  text: string
  /** Already resolved down the default → group → override chain. */
  textStyle: TextStyle
  /** Label anchor, as a fraction of the raw image. */
  x: number
  y: number
  natural: { w: number; h: number }
  view: ViewTransform
}>()

const emit = defineEmits<{ select: [] }>()

const dpr = window.devicePixelRatio || 1

type Raster = { ok: true; sample: Sample } | { ok: false; reason: string }

/**
 * A family that is not in the catalogue is reported, never quietly stood in
 * for. Nothing in this pipeline consults a second face, so drawing one would
 * show a result the application cannot produce (see ADR 0001).
 */
const raster = computed<Raster>(() => {
  const entry = catalogByFamily.value.get(props.textStyle.fontFamily)
  if (!entry) {
    // Nothing to say while the catalogue is still being enumerated: the family
    // is not missing yet, it is unanswered.
    if (!catalogLoaded.value) return { ok: false, reason: '' }
    return { ok: false, reason: `找不到字型「${props.textStyle.fontFamily}」` }
  }
  try {
    return {
      ok: true,
      sample: sampleFor({
        entry,
        text: props.text,
        sizePx: props.textStyle.fontSizePx * props.textStyle.renderScale,
        fillColor: props.textStyle.color,
        stroke: engineStrokeFor(props.textStyle),
        vertical: props.textStyle.direction === 'vertical',
      }),
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
})

const sample = computed(() => (raster.value.ok ? raster.value.sample : null))
const failure = computed(() => (raster.value.ok ? '' : raster.value.reason))

/**
 * The bitmap is rasterized at renderScale, so its size in document pixels is
 * that many times smaller. This is what makes renderScale oversampling rather
 * than a bigger typeface.
 */
const docSize = computed(() => {
  const held = sample.value
  if (!held) return { w: 0, h: 0 }
  return {
    w: held.image.width / props.textStyle.renderScale,
    h: held.image.height / props.textStyle.renderScale,
  }
})

const box = computed(() => {
  const anchor = percentToContentPx(props.x, props.y, props.natural.w, props.natural.h)
  return centeredBoxOnScreen(anchor, docSize.value, props.view)
})

/**
 * A rotated view turns this element with CSS, which resamples what we already
 * resampled. Baking the rotation into the drawImage below would cost one pass
 * instead of two, at the price of a bounding box that is the rotated run's
 * enclosing rectangle rather than the run itself. Upright — where the
 * application spends nearly all of its time — `rotate(0rad)` is the identity
 * and costs nothing, so the question stays open until it can be seen.
 */
const placement = computed(() => `translate(-50%, -50%) rotate(${props.view.rotate}rad)`)

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
  ctx.imageSmoothingQuality = ratio < 1 ? 'high' : 'low'
  ctx.drawImage(sampleSource(held), 0, 0, w, h)
}

onMounted(paint)
// Post-flush: the element has to exist and carry its new size attributes
// before there is anything to draw into.
watch([sample, () => box.value.width, () => box.value.height], paint, { flush: 'post' })
</script>
