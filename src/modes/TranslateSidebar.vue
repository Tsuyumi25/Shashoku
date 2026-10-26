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
      <TabsRoot v-model="section" class="flex min-h-0 flex-1 flex-col">
        <TabsList class="flex h-7 shrink-0 select-none">
          <TabsTrigger value="look" class="side-tab">外觀</TabsTrigger>
          <TabsTrigger value="effects" class="side-tab">效果</TabsTrigger>
        </TabsList>
        <AppearancePanel class="min-h-0 flex-1" :section="section" />
      </TabsRoot>
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { SplitterGroup, SplitterPanel, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import type { AppearanceSection } from '@/lib/appearance'
import AppearancePanel from '@/components/AppearancePanel.vue'
import BucketList from '@/components/BucketList.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * What a selection means, and what it looks like — the two questions a batch
 * pass moves between, stacked.
 *
 * The first is text's alone, since only text carries a meaning; the second
 * takes whatever is selected. That is not an inconsistency — how a node looks
 * is a question every node answers.
 */
const preferences = usePreferencesStore()

const section = ref<AppearanceSection>('look')
</script>
