<template>
  <div v-if="current" class="sample-box" :style="boxStyle">
    <canvas
      ref="canvasEl"
      class="block"
      :width="current.image.width"
      :height="current.image.height"
      :style="boxStyle"
    />
    <CellTextEditor
      v-if="editing"
      :sample="current"
      :text="text"
      :vertical="vertical"
      :start-at="startAt"
      @update:text="emit('update:text', $event)"
      @close="emit('close')"
    />
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
import CellTextEditor from '@/components/CellTextEditor.vue'
import { sampleFor, type Sample, type SampleRequest } from '@/lib/fontSampleCache'

const props = defineProps<{
  entry: FontEntry
  text: string
  sizePx: number
  fillColor: string
  stroke?: EngineStrokeSpec
  /** Columns running right to left instead of rows. */
  vertical?: boolean
  /** Outline the characters this family has no glyph for. */
  mark?: boolean
  /** Puts a caret in this cell. Only one cell may hold it at a time. */
  editing?: boolean
  /** Client point of the click that started editing, if there was one. */
  startAt?: { clientX: number; clientY: number } | null
}>()

const emit = defineEmits<{ 'update:text': [string]; close: [] }>()

/**
 * Literal rather than a theme token: canvas fill styles cannot read CSS custom
 * properties, and the highlight has to stay legible under both themes anyway.
 */
const MARK_COLOR = 'rgba(239, 68, 68, 0.28)'

const canvasEl = useTemplateRef<HTMLCanvasElement>('canvasEl')
/** What belongs on the canvas, which is also the editor's geometry. */
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
 * Sized to the bitmap so the editor overlay, which anchors to this box, lands
 * exactly on the glyphs wherever the cell places the sample. Its own stacking
 * context, so the editor's selection highlight sits under the canvas rather
 * than under the cell.
 */
.sample-box {
  position: relative;
  z-index: 0;
}
</style>
