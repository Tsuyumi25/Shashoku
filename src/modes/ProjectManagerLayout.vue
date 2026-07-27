<template>
  <SplitterGroup
    direction="horizontal"
    class="h-full"
    auto-save-id="project-manager:columns"
    :storage="preferences.panelStorage"
  >
    <SplitterPanel :order="1" :default-size="75" :min-size="40" class="flex min-w-0 flex-col">
      <ProjectManagerMode />
    </SplitterPanel>

    <ResizeHandle />

    <SplitterPanel :order="2" :default-size="25" :min-size="15" class="flex min-w-0 flex-col">
      <ExportPanel />
    </SplitterPanel>
  </SplitterGroup>
</template>

<script setup lang="ts">
import { SplitterGroup, SplitterPanel } from 'reka-ui'
import ExportPanel from '@/components/ExportPanel.vue'
import ResizeHandle from '@/components/ResizeHandle.vue'
import ProjectManagerMode from '@/modes/ProjectManagerMode.vue'
import { usePreferencesStore } from '@/stores/preferencesStore'

/**
 * The labels and groups columns merge into one here. Neither has anything to
 * say about a page you are not editing, and the settings that decide how the
 * whole chapter comes out want the width more.
 */
const preferences = usePreferencesStore()
</script>
