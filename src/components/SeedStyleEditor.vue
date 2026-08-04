<template>
  <div class="h-full min-h-0 overflow-y-auto p-2">
    <p class="mb-1.5 px-0.5 text-xs text-muted-foreground">新物件的起始樣式</p>
    <StyleEditor :value="project.header.seedStyle" @patch="project.updateSeedStyle" />
  </div>
</template>

<script setup lang="ts">
import StyleEditor from '@/components/StyleEditor.vue'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
</script>
