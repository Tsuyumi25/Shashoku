<template>
  <TabsRoot v-model="tab" class="flex h-full min-h-0 flex-col">
    <TabsList class="flex h-7 shrink-0 items-center border-b border-border select-none">
      <TabsTrigger value="group" class="style-tab">群組樣式</TabsTrigger>
      <TabsTrigger value="label" class="style-tab">文字樣式</TabsTrigger>
    </TabsList>

    <TabsContent value="group" class="min-h-0 flex-1 focus:outline-none">
      <GroupStyleEditor />
    </TabsContent>
    <TabsContent value="label" class="min-h-0 flex-1 focus:outline-none">
      <LabelStyleEditor />
    </TabsContent>
  </TabsRoot>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'
import GroupStyleEditor from '@/components/GroupStyleEditor.vue'
import LabelStyleEditor from '@/components/LabelStyleEditor.vue'
import { useEditorStore } from '@/stores/editorStore'

const editor = useEditorStore()

const tab = ref('group')

watch(
  () => editor.activeGroupId,
  () => {
    tab.value = 'group'
  },
)

let lastFilename = editor.currentFilename
watch(
  () => [editor.currentFilename, editor.selectedLabelId] as const,
  ([filename, labelId]) => {
    const pageChanged = filename !== lastFilename
    lastFilename = filename
    if (pageChanged || labelId === null) return
    tab.value = 'label'
  },
)
</script>

<style scoped>
.style-tab {
  height: 100%;
  padding: 0 0.625rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
  border-bottom: 2px solid transparent;
  outline: none;
}
.style-tab:hover {
  color: var(--foreground);
}
.style-tab[data-state='active'] {
  color: var(--foreground);
  border-bottom-color: var(--primary);
}
</style>
