<template>
  <SplitterGroup
    direction="vertical"
    class="min-h-0 flex-1"
    auto-save-id="translate:sidebar"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="34" :min-size="15" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">按語意分堆</span>
      </div>
      <BucketList class="min-h-0 flex-1" />
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="2" :default-size="33" :min-size="15" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">樣式推薦</span>
      </div>
      <StyleRecommendations class="min-h-0 flex-1" />
    </SplitterPanel>

    <ResizeHandle vertical />

    <SplitterPanel :order="3" :default-size="33" :min-size="15" class="flex min-h-0 flex-col">
      <div class="flex h-7 shrink-0 items-center border-b border-border pl-2 select-none">
        <span class="text-xs font-medium text-muted-foreground">文字樣式</span>
      </div>
      <LabelStyleEditor class="min-h-0 flex-1" />
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import BucketList from '@/components/BucketList.vue'
import LabelStyleEditor from '@/components/LabelStyleEditor.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import StyleRecommendations from '@/components/StyleRecommendations.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * What a selection means, what its kind looks like, and what it looks like —
 * the questions a batch pass moves between, stacked. The first two are the same
 * count read twice, one as an audit and one as a prescription, so they sit
 * together; the last is where a value that neither of them offers gets set by
 * hand. Kept on the far side of the canvas from the lists that build a
 * selection, so that picking objects and deciding about them are not the same
 * corner of the screen fighting for room.
 */
const preferences = usePreferencesStore()
</script>
