<template>
  <div ref="stage" class="flex h-full w-full items-center justify-center">
    <!--
      Pointer only, and nothing in here takes focus: the arrow keys belong to
      the page grid beside it, whichever was touched last. A mouse moves the
      divider by hovering, since holding a button down to compare a whole page
      tires the hand; touch and pen, which have no hover, drag it.
    -->
    <div
      class="relative cursor-ew-resize shadow select-none touch-none"
      :style="{ width: `${fitted.w}px`, height: `${fitted.h}px` }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
    >
      <div class="absolute inset-0">
        <slot name="after" />
      </div>
      <div class="absolute inset-0" :style="{ clipPath: `inset(0 ${100 - at}% 0 0)` }">
        <slot name="before" />
      </div>

      <div class="divider" :style="{ left: `${at}%` }">
        <span class="grip"><ChevronsLeftRight :size="12" /></span>
      </div>
      <span class="tag left-1">{{ beforeLabel }}</span>
      <span class="tag right-1">{{ afterLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import { useElementSize } from '@vueuse/core'
import { ChevronsLeftRight } from '@lucide/vue'

/** Two pictures of the same size, one over the other, divided where the slider says. */
const props = defineProps<{ width: number; height: number; beforeLabel: string; afterLabel: string }>()

const at = ref(50)

function follow(e: PointerEvent) {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  if (box.width > 0) at.value = Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100))
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  follow(e)
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerType === 'mouse' || (e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) follow(e)
}

const stage = useTemplateRef<HTMLElement>('stage')
const { width: stageW, height: stageH } = useElementSize(stage)

/** The pictures' box, fitted inside the stage the way object-fit: contain would. */
const fitted = computed(() => {
  const scale = Math.min(stageW.value / props.width, stageH.value / props.height, 1)
  return { w: Math.max(0, props.width * scale), h: Math.max(0, props.height * scale) }
})
</script>

<style scoped>
.divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  background: white;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.35);
  pointer-events: none;
}
.grip {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  transform: translate(-50%, -50%);
  border-radius: 9999px;
  background: white;
  color: black;
  box-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
}
.tag {
  position: absolute;
  top: 0.25rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  background: rgb(0 0 0 / 0.55);
  color: white;
  font-size: 0.6875rem;
  line-height: 1.25rem;
  pointer-events: none;
}
</style>
