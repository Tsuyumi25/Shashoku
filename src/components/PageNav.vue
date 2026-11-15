<template>
  <div class="flex h-7 shrink-0 items-center gap-1 border-b border-border px-1 select-none">
    <button class="page-step" title="上一頁" :disabled="!project.isOpen" @click="editor.pageBy(-1)">
      <ChevronLeft :size="15" />
    </button>
    <button
      class="page-grid"
      :disabled="!project.isOpen"
      title="所有頁面"
      @click="ui.pageManagerOpen = true"
    >
      <LayoutGrid :size="12" class="shrink-0 text-muted-foreground" />
      <template v-if="current">
        <span class="min-w-0 truncate">{{ current.file.page.name }}</span>
        <span class="shrink-0 text-muted-foreground tabular-nums">{{ current.number }} / {{ project.files.length }}</span>
      </template>
      <span v-else class="truncate text-muted-foreground">{{ project.isOpen ? '沒有頁面' : '未開啟專案' }}</span>
    </button>
    <button class="page-step" title="下一頁" :disabled="!project.isOpen" @click="editor.pageBy(1)">
      <ChevronRight :size="15" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, LayoutGrid } from '@lucide/vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const ui = useUiStore()

const current = computed(() => {
  const index = project.files.findIndex((f) => f.pageId === editor.currentPageId)
  return index === -1 ? null : { file: project.files[index]!, number: index + 1 }
})
</script>

<style scoped>
.page-step {
  display: flex;
  height: 1.25rem;
  width: 1.5rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.page-step:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.page-step:disabled {
  opacity: 0.5;
}
.page-grid {
  display: flex;
  height: 1.25rem;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  border-radius: 0.25rem;
  padding: 0 0.375rem;
  font-size: 0.75rem;
}
.page-grid:hover:not(:disabled) {
  background: var(--secondary);
}
.page-grid:disabled {
  opacity: 0.5;
}
</style>
