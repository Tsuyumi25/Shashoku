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
import { cachedSample, loadSample, type SampleRequest } from '@/lib/fontSampleCache'

const props = defineProps<{
  entry: FontEntry
  text: string
  sizePx: number
  fillColor: string
  stroke?: EngineStrokeSpec
  /** While the grid is flying past, hold off on rasterizing anything new. */
  deferred?: boolean
}>()

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
}))

function draw(data: ImageData) {
  const el = canvasEl.value
  if (!el) return
  el.width = data.width
  el.height = data.height
  el.style.width = `${data.width / dpr}px`
  el.style.height = `${data.height / dpr}px`
  el.getContext('2d')?.putImageData(data, 0, 0)
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

let generation = 0

async function render() {
  const mine = ++generation
  failed.value = false

  const hit = cachedSample(request.value)
  if (hit) {
    draw(hit)
    return
  }

  clear()
  if (props.deferred) return

  let data: ImageData
  try {
    data = await loadSample(request.value)
  } catch (err) {
    if (mine !== generation) return
    failure.value = err instanceof Error ? err.message : String(err)
    failed.value = true
    console.error(`font sample failed: ${props.entry.family}`, err)
    return
  }
  if (mine === generation) draw(data)
}

// The first pass waits for mount rather than riding on the watcher's immediate
// run: that fires during setup, when there is no canvas yet, and a cached
// sample would be dropped on the floor with nothing left to re-trigger it.
onMounted(render)
watch([request, () => props.deferred], render, { flush: 'post' })
</script>
