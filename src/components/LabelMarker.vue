<template>
  <div
    class="absolute flex h-6 w-6 cursor-grab items-center justify-center rounded-full text-xs font-bold text-white shadow-md ring-1 ring-black/40 select-none"
    :class="[selected && 'outline-2 outline-offset-2 outline-white']"
    :style="markerStyle"
    @click.stop="emit('select')"
  >
    {{ index }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { percentToContentPx } from '@/lib/coords'

const props = defineProps<{
  index: number
  x: number
  y: number
  color: string
  natural: { w: number; h: number }
  /** Stage scale and rotation, undone here so the badge stays legible. */
  scale: number
  rotate: number
  selected?: boolean
}>()

const emit = defineEmits<{
  select: []
}>()

const markerStyle = computed(() => {
  const p = percentToContentPx(props.x, props.y, props.natural.w, props.natural.h)
  return {
    left: `${p.x}px`,
    top: `${p.y}px`,
    // Origin stays at the default centre: translate(-50%,-50%) puts the centre
    // on the anchor, and the counter rotate/scale then leave it there. A `0 0`
    // origin would drift the badge away from its label.
    transform: `translate(-50%, -50%) rotate(${-props.rotate}rad) scale(${1 / props.scale})`,
    backgroundColor: props.color,
  }
})
</script>
