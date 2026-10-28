<template>
  <button
    type="button"
    class="piece"
    :class="[missing && 'piece-missing', selected && 'piece-selected']"
    :style="{ width: `${w}px`, height: `${h}px` }"
    :title="title"
    @click="emit('open')"
  >
    <canvas ref="canvasEl" :width="cw" :height="ch" :style="{ width: `${w}px`, height: `${h}px` }" />
    <span v-if="missing" class="badge">缺</span>
  </button>
</template>

<script setup lang="ts">
import { computed, onMounted, useTemplateRef, watch } from 'vue'
import { sampleSource, type Sample } from '@/lib/fontSampleCache'

/**
 * One text object as the page draws it, at whatever size the wall shows it.
 * The bitmap is the typesetter's own, so what is on the wall is what is on the
 * page — a missing face shows as the same boxes it does there.
 */
const props = defineProps<{
  sample: Sample | null
  /** Screen pixels per page pixel. */
  scale: number
  missing: boolean
  selected: boolean
  title: string
}>()

const emit = defineEmits<{ open: [] }>()

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')
const dpr = window.devicePixelRatio || 1

const w = computed(() => Math.max(8, (props.sample?.image.width ?? 40) * props.scale))
const h = computed(() => Math.max(8, (props.sample?.image.height ?? 20) * props.scale))
const cw = computed(() => Math.ceil(w.value * dpr))
const ch = computed(() => Math.ceil(h.value * dpr))

function paint() {
  const el = canvasEl.value
  const ctx = el?.getContext('2d')
  if (!el || !ctx) return
  ctx.clearRect(0, 0, el.width, el.height)
  if (!props.sample) return
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(sampleSource(props.sample), 0, 0, el.width, el.height)
}

onMounted(paint)
watch([() => props.sample, cw, ch], paint, { flush: 'post' })
</script>

<style scoped>
.piece {
  position: relative;
  display: block;
  border-radius: 3px;
  outline: 1px solid transparent;
}
.piece:hover {
  outline-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 8%, transparent);
}
.piece-selected,
.piece-selected:hover {
  outline: 2px solid var(--primary);
  background: color-mix(in oklch, var(--primary) 18%, transparent);
}
.piece-missing {
  outline: 2px solid oklch(0.6 0.2 25);
}
.badge {
  position: absolute;
  top: -6px;
  right: -6px;
  border-radius: 9999px;
  background: oklch(0.6 0.2 25);
  padding: 0 4px;
  font-size: 9px;
  line-height: 14px;
  color: white;
}
</style>
