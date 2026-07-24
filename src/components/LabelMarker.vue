<template>
  <div
    class="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full text-xs font-bold text-white shadow-md ring-1 ring-black/40 select-none"
    :class="[selected && 'outline-2 outline-offset-2 outline-white']"
    :style="{ left: `${x}%`, top: `${y}%`, backgroundColor: color }"
  >
    {{ index }}
  </div>
</template>

<script setup lang="ts">
defineProps<{
  index: number
  x: number
  y: number
  color: string
  selected?: boolean
}>()
</script>
