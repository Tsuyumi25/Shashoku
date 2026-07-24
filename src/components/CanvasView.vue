<template>
  <div class="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-muted">
    <div class="relative aspect-[2/3] h-[92%] max-w-[92%] bg-white shadow-md ring-1 ring-black/10">
      <div class="pointer-events-none absolute inset-0 flex flex-col text-[10px] tracking-widest text-neutral-400 select-none">
        <div class="flex flex-1 items-start justify-center pt-6">page 001</div>
      </div>

      <LabelMarker
        v-for="m in markers"
        :key="m.index"
        :index="m.index"
        :x="m.x"
        :y="m.y"
        :color="m.color"
        :selected="m.index === 2"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import LabelMarker from '@/components/LabelMarker.vue'

const markers = [
  { index: 1, x: 22, y: 14, color: '#e26a3b' },
  { index: 2, x: 68, y: 22, color: '#3b7fe2' },
  { index: 3, x: 34, y: 42, color: '#e26a3b' },
  { index: 4, x: 72, y: 56, color: '#3b7fe2' },
  { index: 5, x: 40, y: 74, color: '#7a7a7a' },
  { index: 6, x: 60, y: 86, color: '#e26a3b' },
]
</script>
