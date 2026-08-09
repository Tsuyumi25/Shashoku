<template>
  <TabsRoot v-model="tab" class="flex h-full min-h-0 flex-col">
    <TabsList class="tabs">
      <TabsTrigger value="source" class="tab">素材</TabsTrigger>
      <TabsTrigger value="export" class="tab">輸出</TabsTrigger>
    </TabsList>

    <!--
      One splitter per tab rather than one that swaps its contents, because each
      remembers a width and they want different ones: side by side with the
      folder the pages came from, half and half reads as a comparison; beside
      the delivery settings, the pages want the room.

      No display class here — an unselected panel carries `hidden`, and giving
      it one would override that and lay both of them out at once.
    -->
    <TabsContent value="source" class="min-h-0 flex-1 focus:outline-none">
      <SplitterGroup
        direction="horizontal"
        class="h-full"
        auto-save-id="project-manager:columns:source"
        :storage="preferences.panelStorage"
      >
        <SplitterPanel :order="1" :default-size="50" :min-size="20" class="flex min-w-0 flex-col">
          <SourcePanel />
        </SplitterPanel>

        <ResizeHandle />

        <SplitterPanel :order="2" :default-size="50" :min-size="20" class="flex min-w-0 flex-col">
          <ProjectManagerMode />
        </SplitterPanel>
      </SplitterGroup>
    </TabsContent>

    <TabsContent value="export" class="min-h-0 flex-1 focus:outline-none">
      <SplitterGroup
        direction="horizontal"
        class="h-full"
        auto-save-id="project-manager:columns:export"
        :storage="preferences.panelStorage"
      >
        <SplitterPanel :order="1" :default-size="25" :min-size="15" class="flex min-w-0 flex-col">
          <ExportPanel />
        </SplitterPanel>

        <ResizeHandle />

        <SplitterPanel :order="2" :default-size="75" :min-size="40" class="flex min-w-0 flex-col">
          <ProjectManagerMode />
        </SplitterPanel>
      </SplitterGroup>
    </TabsContent>
  </TabsRoot>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  SplitterGroup,
  SplitterPanel,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from 'reka-ui'
import ExportPanel from '@/components/ExportPanel.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import SourcePanel from '@/components/SourcePanel.vue'
import ProjectManagerMode from '@/modes/ProjectManagerMode.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * The pages are always the main grid; the tabs decide what sits beside them.
 *
 * Not a fourth column. The delivery settings are only wanted while delivering —
 * they have nothing to say while you are looking at what came in — so the
 * source panel takes that column over rather than adding to it.
 *
 * Tabs rather than a segmented control, which is what this was first: a segment
 * picker says "one of these settings", and these are not settings but two views
 * of the same project. Real tabs also come with the roles and the arrow keys,
 * and with a target the height of the strip rather than the height of the text.
 *
 * Leaving a tab unmounts it, which is what makes arriving at the source panel
 * the moment it re-reads the folder.
 *
 * Which tab is up is not remembered across sessions on purpose: which of the
 * two jobs you are here for is a property of this visit, not of the project.
 */
const preferences = usePreferencesStore()

const tab = ref('source')
</script>

<style scoped>
.tabs {
  display: flex;
  align-items: stretch;
  height: 2rem;
  flex-shrink: 0;
  padding: 0 0.25rem;
  border-bottom: 1px solid var(--border);
  user-select: none;
}

/* The whole height of the strip, not the height of the label: a tab that is
   only as tall as its text is a tab people miss. */
.tab {
  position: relative;
  cursor: pointer;
  padding: 0 0.875rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
  outline: none;
}
.tab:hover {
  color: var(--foreground);
}
.tab[data-state='active'] {
  color: var(--foreground);
}
/* Over the strip's own border rather than beside it, so the selected tab reads
   as joined to what is under it. */
.tab[data-state='active']::after {
  content: '';
  position: absolute;
  right: 0.375rem;
  bottom: -1px;
  left: 0.375rem;
  height: 2px;
  border-radius: 1px;
  background: var(--primary);
}
.tab:focus-visible {
  border-radius: 0.25rem;
  outline: 2px solid var(--ring);
  outline-offset: -3px;
}
</style>
