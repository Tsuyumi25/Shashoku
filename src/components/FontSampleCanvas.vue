<template>
  <canvas ref="canvasEl" class="block" />
  <span
    v-if="failed"
    class="text-destructive/70"
    :style="{ fontSize: `${sizePx * 0.4}px` }"
    :title="failure"
  >
    無法繪製
  </span>
  <span
    v-else-if="!drawn"
    class="text-muted-foreground/40"
    :style="{ fontSize: `${sizePx * 0.4}px` }"
  >
    載入中…
  </span>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'
import type { EngineStrokeSpec } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import { sampleFor, type Sample, type SampleRequest } from '@/lib/fontSampleCache'

const props = defineProps<{
  entry: FontEntry
  text: string
  sizePx: number
  fillColor: string
  stroke?: EngineStrokeSpec
  /** Stands in for characters this family cannot draw; omit to leave tofu. */
  fallback?: FontEntry
  /** Outline the characters this family has no glyph for. */
  mark?: boolean
  /** While the grid is flying past, hold off on rasterizing anything new. */
  deferred?: boolean
}>()

/**
 * Literal rather than a theme token: canvas fill styles cannot read CSS custom
 * properties, and the highlight has to stay legible under both themes anyway.
 */
const MARK_COLOR = 'rgba(239, 68, 68, 0.28)'

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')
const drawn = ref(false)
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
  fallback: props.fallback,
}))

function draw(sample: Sample) {
  const el = canvasEl.value
  if (!el) return
  const { image, marks } = sample
  el.width = image.width
  el.height = image.height
  el.style.width = `${image.width / dpr}px`
  el.style.height = `${image.height / dpr}px`

  const ctx = el.getContext('2d')
  if (!ctx) return

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

  drawn.value = true
}

function clear() {
  const el = canvasEl.value
  if (!el) return
  el.width = 0
  el.height = 0
  el.style.removeProperty('width')
  el.style.removeProperty('height')
  drawn.value = false
}

function render() {
  failed.value = false

  if (props.deferred) {
    clear()
    return
  }

  try {
    draw(sampleFor(request.value))
  } catch (err) {
    clear()
    failure.value = err instanceof Error ? err.message : String(err)
    failed.value = true
    console.error(`font sample failed: ${props.entry.family}`, err)
  }
}

// The first pass waits for mount rather than riding on the watcher's immediate
// run: that fires during setup, when there is no canvas to draw on yet.
onMounted(render)
// props.mark is not part of the cache key — toggling it only changes how an
// already-rasterized sample is painted.
watch([request, () => props.deferred, () => props.mark], render, { flush: 'post' })
</script>
