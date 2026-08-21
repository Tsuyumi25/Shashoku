<template>
  <div v-if="current" class="sample-box" :style="boxStyle">
    <canvas
      ref="canvasEl"
      class="block"
      :width="current.image.width"
      :height="current.image.height"
      :style="boxStyle"
    />
    <div v-for="(box, i) in highlightBoxes" :key="i" class="highlight-box" :style="box" />
  </div>
  <span
    v-if="failed"
    class="text-destructive/70"
    :style="{ fontSize: `${sizePx * 0.4}px` }"
    :title="failure"
  >
    無法繪製
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { EngineStrokeSpec } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import { sampleFor, type Sample, type SampleRequest } from '@/lib/fontSampleCache'
import { textProjection } from '@/lib/textProjection'

const props = defineProps<{
  entry: FontEntry
  text: string
  sizePx: number
  fillColor: string
  stroke?: EngineStrokeSpec
  /** Columns running right to left instead of rows. */
  vertical?: boolean
  /** Signed pixels the strokes move by. */
  weightPx?: number
  /** Outline the characters this family has no glyph for. */
  mark?: boolean
  /**
   * Show the whole sample as selected, because the field that owns it has the
   * caret and its text selected. Only one cell may hold it at a time.
   */
  highlighted?: boolean
}>()

/**
 * Literal rather than a theme token: canvas fill styles cannot read CSS custom
 * properties, and the highlight has to stay legible under both themes anyway.
 */
const MARK_COLOR = 'rgba(239, 68, 68, 0.28)'

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')
/** What belongs on the canvas, which is also the highlight's geometry. */
const current = shallowRef<Sample | null>(null)
const failed = ref(false)
const failure = ref('')

// Rasterizing at device resolution keeps glyph shapes judgeable on a HiDPI
// panel, which is the entire point of looking at a sample.
const dpr = window.devicePixelRatio || 1

const request = computed<SampleRequest>(() => ({
  entry: props.entry,
  text: props.text,
  sizePx: Math.round(props.sizePx * dpr),
  fillColor: props.fillColor,
  stroke: props.stroke,
  vertical: props.vertical,
  // Scaled with the size: the sample is drawn at device resolution and shown
  // back down, so an unscaled offset would read thinner than it will typeset.
  weightPx: (props.weightPx ?? 0) * dpr,
}))

const boxStyle = computed(() =>
  current.value
    ? {
        width: `${current.value.image.width / dpr}px`,
        height: `${current.value.image.height / dpr}px`,
      }
    : undefined,
)

/**
 * The whole sample, boxed line by line rather than as one rectangle over the
 * bitmap: a line shorter than the longest one would otherwise be highlighted
 * past its end, and a vertical run would get a horizontal band across columns
 * it does not fill. Read off the engine's clusters, so the highlight lands on
 * the glyphs however the run was laid out.
 */
const highlightBoxes = computed(() => {
  const sample = current.value
  if (!props.highlighted || !sample || props.text.length === 0) return []
  const projection = textProjection({
    text: props.text,
    clusters: sample.clusters,
    vertical: props.vertical ?? false,
    padding: sample.padding,
    crossExtent: props.vertical ? sample.image.width : sample.image.height,
  })
  return projection.selection(0, props.text.length).map((box) => ({
    left: `${box.x / dpr}px`,
    top: `${box.y / dpr}px`,
    width: `${box.width / dpr}px`,
    height: `${box.height / dpr}px`,
  }))
})

/**
 * Runs during setup, not on mount. The virtual list measures a row the moment
 * its element exists, and a canvas whose size arrives later gets measured at
 * the wrong height — the list then compensates by moving the scroll position,
 * which is a change of size, which measures again.
 */
function rasterize() {
  try {
    current.value = sampleFor(request.value)
    failed.value = false
  } catch (err) {
    current.value = null
    failure.value = err instanceof Error ? err.message : String(err)
    failed.value = true
    console.error(`font sample failed: ${props.entry.family}`, err)
  }
}
watch(request, rasterize, { immediate: true })

function paint() {
  const el = canvasEl.value
  const sample = current.value
  if (!el || !sample) return
  const ctx = el.getContext('2d')
  if (!ctx) return

  const { image, marks } = sample
  if (props.mark && marks.length > 0) {
    for (const rect of marks) {
      ctx.fillStyle = MARK_COLOR
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
    }
    // putImageData replaces pixels instead of compositing, which would wipe
    // the highlights; going through drawImage keeps them behind the glyphs.
    const glyphs = new OffscreenCanvas(image.width, image.height)
    glyphs.getContext('2d')?.putImageData(image, 0, 0)
    ctx.drawImage(glyphs, 0, 0)
  } else {
    ctx.putImageData(image, 0, 0)
  }
}

// Post-flush: setting the width and height attributes blanks the canvas, so the
// pixels have to go on after Vue has patched them.
onMounted(paint)
watch([current, () => props.mark], paint, { flush: 'post' })
</script>

<style scoped>
/*
 * Sized to the bitmap so the highlight, which anchors to this box, lands
 * exactly on the glyphs wherever the cell places the sample. Its own stacking
 * context, so the highlight sits under the canvas rather than under the cell.
 */
.sample-box {
  position: relative;
  z-index: 0;
}
/* Behind the glyphs, the way a selection in a text field is. */
.highlight-box {
  position: absolute;
  z-index: -1;
  background: var(--primary);
  opacity: 0.25;
}
</style>
