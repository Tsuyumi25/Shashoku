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
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 pr-1 text-xs select-none">
        <span class="font-medium text-foreground">外觀</span>
        <button
          type="button"
          class="ml-auto h-5 rounded border px-2 transition-colors"
          :class="
            effectsOpen
              ? 'border-primary text-foreground'
              : 'border-input text-muted-foreground hover:border-primary hover:text-foreground'
          "
          :aria-pressed="effectsOpen"
          title="光暈、網點這些特效，放在可以拖到任何地方的浮動面板裡"
          @click="toggleEffects"
        >
          特效
        </button>
      </div>
      <AppearancePanel class="min-h-0 flex-1" />
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useWindowSize } from '@vueuse/core'
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import AppearancePanel from '@/components/AppearancePanel.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { firstEffectsPanelPlace } from '@/lib/effectsPanel'
import ToolBoard from '@/modes/ToolBoard.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * The verbs on top and what the selection looks like under them, the line
 * between them where the reader wants it. The effects a label only sometimes
 * wants float in a panel of their own, opened from the appearance heading.
 */
const preferences = usePreferencesStore()
const { width: windowW } = useWindowSize()

const effectsOpen = computed(() => preferences.prefs.effectsPanel?.open === true)

function toggleEffects() {
  preferences.setEffectsPanelOpen(!effectsOpen.value, firstEffectsPanelPlace(windowW.value))
}
</script>
