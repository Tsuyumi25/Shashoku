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
      <span class="text-muted-foreground">比較</span>
      <div class="flex flex-wrap gap-1">
        <button
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="
            wallFields.has('fontFamily')
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          "
          @click="toggleField('fontFamily')"
        >
          {{ TEXT_STYLE_FIELD_NAMES.fontFamily }}
        </button>
        <button
          type="button"
          class="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          :title="rareOpen ? '收起其他欄位' : '依其他欄位分堆'"
          @click="rareOpen = !rareOpen"
        >
          {{ rareOpen ? '收起' : `其他欄位${rareOn ? `（${rareOn}）` : ''}` }}
        </button>
      </div>
      <div v-if="rareOpen" class="flex flex-wrap gap-1">
        <button
          v-for="f in WALL_RARE_FIELDS"
          :key="f"
          type="button"
          class="rounded px-1.5 py-0.5"
          :class="
            wallFields.has(f)
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          "
          @click="toggleField(f)"
        >
          {{ TEXT_STYLE_FIELD_NAMES[f] }}
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
      先依標記分組，再依勾選的欄位分堆，跟語意分堆同一套。點一句回到它所在的頁面並選中它；點組名收合。
    </p>
  </div>
</template>

<script setup lang="ts">
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELD_NAMES } from '@/lib/textStyleFields'
import { computed, ref } from 'vue'
import {
  WALL_RARE_FIELDS,
  wallFields,
  wallScope,
  wallSize,
  type WallScope,
  type WallSize,
} from '@/lib/wall'

/** Folded away while none of them is in use, since a face is nearly always what a bucket is. */
const rareOn = computed(() => WALL_RARE_FIELDS.filter((f) => wallFields.value.has(f)).length)
const rareOpen = ref(rareOn.value > 0)

function onScope(v: unknown) {
  if (v === 'page' || v === 'chapter') wallScope.value = v as WallScope
}

function onSize(v: unknown) {
  if (v === 'uniform' || v === 'eased' || v === 'proportional') wallSize.value = v as WallSize
}

function toggleField(field: keyof TextStyle) {
  const next = new Set(wallFields.value)
  if (!next.delete(field)) next.add(field)
  wallFields.value = next
}
</script>
