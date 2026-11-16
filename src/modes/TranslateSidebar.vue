<template>
  <SplitterGroup
    direction="vertical"
    class="min-h-0 flex-1"
    auto-save-id="translate:sidebar:v3"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="18" :min-size="8" class="flex min-h-0 flex-col overflow-y-auto">
      <ToolBoard />
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="2" :default-size="82" :min-size="20" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-stretch border-b border-border text-xs select-none" role="tablist">
        <button
          v-for="t in TABS"
          :key="t.tab"
          type="button"
          role="tab"
          class="border-b-2 px-2 transition-colors"
          :class="
            tab === t.tab
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          "
          :aria-selected="tab === t.tab"
          @click="tab = t.tab"
        >
          {{ t.label }}
        </button>
      </div>
      <AppearancePanel class="min-h-0 flex-1" :tab="tab" />
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import AppearancePanel from '@/components/AppearancePanel.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import ToolBoard from '@/modes/ToolBoard.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * The verbs on top and what the selection looks like under them, the line
 * between them where the reader wants it.
 */
const preferences = usePreferencesStore()

/**
 * The colour, weight and strokes every label is set with stay in front; the
 * effects a label only sometimes wants wait one tab over.
 */
const TABS = [
  { tab: 'appearance', label: '外觀' },
  { tab: 'effects', label: '特效' },
] as const

const tab = ref<(typeof TABS)[number]['tab']>('appearance')
</script>
