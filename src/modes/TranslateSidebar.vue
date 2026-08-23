<template>
  <SplitterGroup
    direction="vertical"
    class="min-h-0 flex-1"
    auto-save-id="translate:sidebar:v2"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="34" :min-size="15" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">按語意分堆</span>
      </div>
      <BucketList class="min-h-0 flex-1" />
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="2" :default-size="66" :min-size="15" class="flex min-h-0 flex-col">
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
import BucketList from '@/components/BucketList.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * What a selection means, and what it looks like — the two questions a batch
 * pass moves between, stacked. Kept on the far side of the canvas from the
 * lists that build a selection, so that picking objects and deciding about them
 * are not the same corner of the screen fighting for room.
 *
 * The first is text's alone, since only text carries a meaning; the second
 * takes whatever is selected. That is not an inconsistency — how a node looks
 * is a question every node answers.
 */
const preferences = usePreferencesStore()
</script>
