<template>
  <div
    class="absolute flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow-md ring-1 ring-black/40 select-none"
    :class="[
      selected && 'outline-2 outline-offset-2 outline-white',
      drag.dragging.value ? 'cursor-grabbing' : 'cursor-grab',
    ]"
    :style="markerStyle"
    @pointerdown.stop="drag.onPointerDown"
    @pointermove="drag.onPointerMove"
    @pointerup="drag.onPointerUp"
    @pointercancel="drag.onPointerUp"
  >
    {{ index }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useLabelDrag, type Anchor } from '@/composables/useLabelDrag'
import { percentToContentPx, type ViewTransform } from '@/lib/coords'

const props = defineProps<{
  index: number
  x: number
  y: number
  color: string
  natural: { w: number; h: number }
  /**
   * The view the badge lives in. Its scale and rotation are undone here so the
   * badge stays legible, and a drag needs the same transform to invert.
   */
  view: ViewTransform
  selected?: boolean
}>()

const emit = defineEmits<{
  select: []
  move: [to: Anchor]
  moveEnd: [from: Anchor, to: Anchor]
}>()

const drag = useLabelDrag({
  anchor: () => ({ x: props.x, y: props.y }),
  natural: () => props.natural,
  view: () => props.view,
  onSelect: () => emit('select'),
  onMove: (to) => emit('move', to),
  onCommit: (from, to) => emit('moveEnd', from, to),
})

const markerStyle = computed(() => {
  const p = percentToContentPx(props.x, props.y, props.natural.w, props.natural.h)
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    // Origin stays at the default centre: translate(-50%,-50%) puts the centre
    // on the anchor, and the counter rotate/scale then leave it there. A `0 0`
    // origin would drift the badge away from its label.
    transform: `translate(-50%, -50%) rotate(${-props.view.rotate}rad) scale(${1 / props.view.scale})`,
    backgroundColor: props.color,
  }
})
</script>
