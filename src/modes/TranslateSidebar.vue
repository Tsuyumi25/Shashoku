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
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">外觀</span>
      </div>
      <AppearancePanel class="min-h-0 flex-1" />
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import AppearancePanel from '@/components/AppearancePanel.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import ToolBoard from '@/modes/ToolBoard.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * The verbs on top and what the selection looks like under them, the line
 * between them where the reader wants it.
 *
 * The semantic buckets used to share this column. They are needed when they
 * are needed — a few times a chapter, and then wanting a lot of room — so they
 * live in the wall's own window rather than holding a third of it the rest of
 * the time.
 */
const preferences = usePreferencesStore()
</script>
