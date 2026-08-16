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

    <!--
      The project's name, centred on the bar rather than flexed between its
      neighbours, so it does not wander when the page select grows. The dot is
      the unsaved marker the title bar used to carry.
    -->
    <span
      class="pointer-events-none absolute left-1/2 max-w-[40%] -translate-x-1/2 truncate text-xs text-muted-foreground"
    >
      {{ title }}
    </span>

    <div class="flex-1" />

    <select
      class="h-5 max-w-64 min-w-0 rounded border border-input bg-background px-1 text-xs disabled:opacity-50"
      :value="editor.currentPageId ?? ''"
      :disabled="!project.isOpen"
      @change="onSelect"
    >
      <option v-if="!project.isOpen" value="">未開啟專案</option>
      <option v-for="f in project.files" :key="f.pageId" :value="f.pageId">
        {{ f.page.name }}{{ f.page.readingOrder.length > 0 ? `（${f.page.readingOrder.length}）` : '' }}
      </option>
    </select>
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
  Maximize,
  ZoomIn,
  ZoomOut,
} from '@lucide/vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const percentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
})
const scalePercent = computed(() => percentFormat.format(editor.view.scale))

const title = computed(() => {
  if (!project.isOpen) return ''
  const dir = project.folderPath?.split('/').pop() ?? ''
  return `${project.dirty ? '● ' : ''}${dir}`
})

/** The same act as the arrows beside it, so it leaves the selection alone too. */
function onSelect(e: Event) {
  editor.showPage((e.target as HTMLSelectElement).value)
}
</script>

<style scoped>
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
</style>
