<template>
  <PopoverRoot>
    <PopoverTrigger
      class="shrink-0 rounded p-1 hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
      title="顯示選項"
    >
      <SlidersHorizontal :size="14" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent class="picker-options" side="bottom" align="end" :side-offset="6">
        <label class="flex items-center gap-1.5" title="畫不出當前樣本文字的字體，不列在清單裡">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 accent-primary"
            :checked="hiding"
            @change="onHide($event)"
          />
          隱藏缺字的字體
        </label>
        <label
          class="flex items-center gap-1.5"
          :class="hiding ? 'cursor-not-allowed opacity-40' : ''"
          :title="hiding ? '清單裡沒有缺字的字體了，沒有東西可以標記' : '把畫不出來的那幾個字框起來'"
        >
          <input
            type="checkbox"
            class="h-3.5 w-3.5 accent-primary"
            :checked="preferences.prefs.markMissingGlyphs"
            :disabled="hiding"
            @change="onMark($event)"
          />
          標記缺字
        </label>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { SlidersHorizontal } from '@lucide/vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()
const hiding = computed(() => preferences.prefs.missingGlyphMode === 'hide')

function onHide(e: Event) {
  preferences.setMissingGlyphMode((e.target as HTMLInputElement).checked ? 'hide' : 'tofu')
}

function onMark(e: Event) {
  preferences.setMarkMissingGlyphs((e.target as HTMLInputElement).checked)
}
</script>

<style>
/* Portalled out of the component, so a scoped block would not reach it. */
.picker-options {
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
