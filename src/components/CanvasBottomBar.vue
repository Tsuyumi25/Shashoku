<template>
  <div class="relative flex h-7 shrink-0 items-center gap-1 border-t border-border bg-card px-1 select-none">
    <button class="page-btn" title="縮小" :disabled="!project.isOpen" @click="editor.zoomBy(1 / 1.25)">
      <ZoomOut :size="14" />
    </button>
    <button class="page-btn" title="放大" :disabled="!project.isOpen" @click="editor.zoomBy(1.25)">
      <ZoomIn :size="14" />
    </button>
    <span class="px-1 text-xs text-muted-foreground tabular-nums">
      {{ scalePercent }}
    </span>
    <button class="page-btn" title="適應視窗" :disabled="!project.isOpen" @click="editor.fitToView()">
      <Maximize :size="13" />
    </button>
    <button
      class="page-btn"
      :class="editor.tagsShown && 'page-btn-on'"
      :aria-pressed="editor.tagsShown"
      title="在畫布上用底色和字章看每個文字物件的標記"
      :disabled="!project.isOpen"
      @click="editor.tagsShown = !editor.tagsShown"
    >
      <Tag :size="13" />
    </button>

    <!--
      Centred on the bar rather than flexed between its neighbours, so it does
      not wander when the page button grows.
    -->
    <div class="absolute left-1/2 flex max-w-[40%] -translate-x-1/2 justify-center">
      <FaceSwitch />
    </div>

    <div class="flex-1" />

    <button
      class="page-picker"
      :disabled="!project.isOpen"
      title="頁面"
      @click="ui.pageManagerOpen = true"
    >
      <template v-if="current">
        <span class="min-w-0 truncate">{{ current.file.page.name }}</span>
        <span class="shrink-0 text-muted-foreground tabular-nums">{{ current.number }} / {{ project.files.length }}</span>
      </template>
      <span v-else class="text-muted-foreground">{{ project.isOpen ? '沒有頁面' : '未開啟專案' }}</span>
      <LayoutGrid :size="12" class="shrink-0 text-muted-foreground" />
    </button>
    <button class="page-btn" title="上一頁" @click="editor.pageBy(-1)">
      <ChevronLeft :size="15" />
    </button>
    <button class="page-btn" title="下一頁" @click="editor.pageBy(1)">
      <ChevronRight :size="15" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Maximize,
  Tag,
  ZoomIn,
  ZoomOut,
} from '@lucide/vue'
import FaceSwitch from '@/components/FaceSwitch.vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const project = useProjectStore()
const editor = useEditorStore()
const ui = useUiStore()

const percentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
})
const scalePercent = computed(() => percentFormat.format(editor.view.scale))

const current = computed(() => {
  const index = project.files.findIndex((f) => f.pageId === editor.currentPageId)
  return index === -1 ? null : { file: project.files[index]!, number: index + 1 }
})
</script>

<style scoped>
.page-picker {
  display: flex;
  height: 1.25rem;
  max-width: 16rem;
  min-width: 0;
  align-items: center;
  gap: 0.375rem;
  border-radius: 0.25rem;
  border: 1px solid var(--input);
  background: var(--background);
  padding: 0 0.375rem;
  font-size: 0.75rem;
}
.page-picker:hover:not(:disabled) {
  background: var(--secondary);
}
.page-picker:disabled {
  opacity: 0.5;
}
.page-btn {
  display: flex;
  height: 1.25rem;
  width: 1.5rem;
  align-items: center;
  justify-content: center;
  border-radius: 0.25rem;
  color: var(--muted-foreground);
}
.page-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.page-btn:disabled {
  opacity: 0.5;
}
.page-btn-on {
  background: var(--secondary);
  color: var(--primary);
}
</style>
