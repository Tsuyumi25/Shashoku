<template>
  <div class="flex flex-col gap-3 p-2 text-xs">
    <div class="flex flex-col gap-1">
      <span class="text-muted-foreground">範圍</span>
      <ToggleGroupRoot type="single" class="seg w-full" :model-value="wallScope" @update:model-value="onScope">
        <ToggleGroupItem value="page" class="seg-item">本頁</ToggleGroupItem>
        <ToggleGroupItem value="chapter" class="seg-item">本話</ToggleGroupItem>
      </ToggleGroupRoot>
    </div>
    <div class="flex flex-col gap-1">
      <span class="text-muted-foreground">分堆依據</span>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="a in WALL_ATTRIBUTES"
          :key="a.id"
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="wallAttribute === a.id ? on : off"
          @click="wallAttribute = a.id"
        >
          {{ a.label }}
        </button>
      </div>
    </div>
    <div class="flex flex-col gap-1">
      <span class="text-muted-foreground">大小</span>
      <ToggleGroupRoot type="single" class="seg w-full" :model-value="wallSize" @update:model-value="onSize">
        <ToggleGroupItem value="uniform" class="seg-item" title="每句一樣大，只比字型">統一</ToggleGroupItem>
        <ToggleGroupItem value="eased" class="seg-item" title="大的還是大，但差距拉近，一屏裝得下">緩和</ToggleGroupItem>
        <ToggleGroupItem value="proportional" class="seg-item" title="照字級的比例縮小">等比</ToggleGroupItem>
      </ToggleGroupRoot>
    </div>
    <p class="text-muted-foreground">
      先依標記分組，再依選的那一個屬性分堆，每一堆就是一個值。點一句回到它所在的頁面並選中它，按著 Shift 點則加進或拿出目前的選取；點堆名或組名選整堆，按著 Shift 就疊上去，整堆都在時再點一次拿掉。
    </p>
  </div>
</template>

<script setup lang="ts">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import { WALL_ATTRIBUTES } from '@/lib/wallAttributes'
import {
  wallAttribute,
  wallScope,
  wallSize,
  type WallScope,
  type WallSize,
} from '@/lib/wall'

const on = 'bg-accent text-accent-foreground'
const off = 'text-muted-foreground hover:bg-secondary hover:text-foreground'

function onScope(v: unknown) {
  if (v === 'page' || v === 'chapter') wallScope.value = v as WallScope
}

function onSize(v: unknown) {
  if (v === 'uniform' || v === 'eased' || v === 'proportional') wallSize.value = v as WallSize
}
</script>
