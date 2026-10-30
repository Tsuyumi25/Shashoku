<template>
  <DialogRoot :open="face !== null" @update:open="(open) => !open && emit('close')">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="sample-zoom" :aria-describedby="undefined">
        <div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
          <DialogTitle class="min-w-0 flex-1 truncate text-sm">
            {{ face?.displayName }}
            <span class="text-muted-foreground">{{ face?.style }}</span>
          </DialogTitle>
          <span class="text-xs tabular-nums text-muted-foreground">{{ sizePx }}px</span>
          <DialogClose class="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" title="關閉">
            <X :size="16" />
          </DialogClose>
        </div>
        <div ref="stage" class="flex min-h-0 flex-1 overflow-auto p-6" @wheel="onWheel">
          <!-- Centred by margins rather than by the flex box, so a sample larger
               than the stage scrolls from its first edge instead of losing it. -->
          <div ref="sheet" class="m-auto">
            <FontSampleCanvas
              v-if="face && room"
              :entry="face"
              :text="text"
              :size-px="sizePx"
              :fit-width="Infinity"
              :fit-height="Infinity"
              :fill-color="fillColor"
              :stroke="stroke && { ...stroke, width: stroke.width * ratio }"
              :vertical="vertical"
              :weight-px="weightPx * ratio"
              :mark="mark"
            />
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import { X } from '@lucide/vue'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import type { EngineStrokeSpec } from '@shared/engine/types'
import type { FontEntry } from '@shared/fonts/types'
import FontSampleCanvas from '@/components/FontSampleCanvas.vue'
import { fittedSize } from '@/lib/sampleFit'

/**
 * One face's sample, the whole text and nothing cut. As large as the window
 * lets it be while that stays readable; past that it holds the readable size
 * and scrolls, since a long sample fitted whole is as unreadable here as in a
 * cell.
 */
const props = defineProps<{
  face: FontEntry | null
  text: string
  vertical: boolean
  fillColor: string
  /** At the size the stroke and weight were given for. */
  stroke?: EngineStrokeSpec
  weightPx: number
  givenAtPx: number
  mark?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const stage = ref<HTMLElement | null>(null)
const sheet = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(stage)
const { width: sheetWidth } = useElementSize(sheet)
/** The stage less its padding. */
const room = computed(() => (width.value > 0 ? { w: width.value - 48, h: height.value - 48 } : null))
/** Smallest the popup sets a sample, in CSS pixels; it scrolls rather than go below. */
const READABLE_PX = 48
const sizePx = computed(() =>
  room.value ? Math.max(READABLE_PX, fittedSize(props.text, room.value, props.vertical)) : READABLE_PX,
)
const ratio = computed(() => (props.givenAtPx > 0 ? sizePx.value / props.givenAtPx : 1))

/**
 * Columns run across, so the wheel moves along them: down reads on, which in
 * columns set right to left is leftward. A wheel that already moves sideways —
 * a trackpad, or Shift — is left to the browser.
 */
function onWheel(e: WheelEvent) {
  const el = stage.value
  if (!props.vertical || !el || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
  e.preventDefault()
  el.scrollLeft -= e.deltaY
}

// Columns read from the right, so a scrolled column sample opens at its start.
watch(
  () => [props.face, props.vertical, sheetWidth.value],
  async () => {
    await nextTick()
    const el = stage.value
    if (el && props.vertical) el.scrollLeft = el.scrollWidth
  },
)
</script>

<style>
/* Portalled out of the component, so a scoped block would not reach it. */
.sample-zoom {
  position: fixed;
  z-index: 50;
  top: 50%;
  left: 50%;
  display: flex;
  width: min(90vw, 1400px);
  height: 85vh;
  flex-direction: column;
  transform: translate(-50%, -50%);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--background);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
}
</style>
