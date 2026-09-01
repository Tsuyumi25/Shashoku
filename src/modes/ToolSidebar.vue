<template>
  <SplitterGroup
    direction="vertical"
    class="min-h-0 flex-1"
    auto-save-id="translate:tools:v1"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="30" :min-size="10" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">子工具</span>
      </div>
      <SubToolPalette class="min-h-0 flex-1" />
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="2" :default-size="45" :min-size="15" class="flex min-h-0 flex-col">
      <ToolBoard />
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="3" :default-size="25" :min-size="10" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">色環</span>
      </div>
      <ColorWheel class="min-h-0 flex-1" />
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import ColorWheel from '@/components/ColorWheel.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import SubToolPalette from '@/components/SubToolPalette.vue'
import ToolBoard from '@/modes/ToolBoard.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

const preferences = usePreferencesStore()
</script>
