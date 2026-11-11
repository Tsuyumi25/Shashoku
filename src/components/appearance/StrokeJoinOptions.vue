<template>
  <PopoverRoot>
    <PopoverTrigger
      class="shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
      title="描邊選項"
    >
      <SlidersHorizontal :size="14" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="stroke-options" side="bottom" align="end" :side-offset="6">
        <label
          class="flex items-center gap-1.5"
          :class="state === null && 'cursor-not-allowed opacity-40'"
          :title="
            state === null
              ? '沒有看得到的描邊'
              : '最外圈描邊和下面同色的最外圈連成一片，不壓到彼此；內圈照疊放的順序蓋'
          "
        >
          <input
            type="checkbox"
            class="h-3.5 w-3.5 accent-primary"
            :checked="state === 'on'"
            :indeterminate="state === 'mixed'"
            :disabled="state === null"
            @change="emit('change', ($event.target as HTMLInputElement).checked)"
          />
          最外圈和同色描邊連成一片
        </label>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { SlidersHorizontal } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

/** Whether the selection's outermost strokes join; null when none of them shows. */
export type JoinState = 'on' | 'off' | 'mixed' | null

defineProps<{ state: JoinState }>()
const emit = defineEmits<{ change: [joins: boolean] }>()
</script>

<style>
/* Portalled out of the component, so a scoped block would not reach it. */
.stroke-options {
  z-index: 50;
  display: flex;
  width: 15rem;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 0.375rem;
  background: var(--popover);
  color: var(--popover-foreground);
  font-size: 0.8125rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}
</style>
