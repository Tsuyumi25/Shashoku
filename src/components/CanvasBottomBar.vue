<template>
  <div class="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-card px-1 select-none">
    <!--
      The text tool is sticky, so this is the only standing answer to which
      tool is up: the crosshair cursor disappears with the pointer.
    -->
    <button
      class="page-btn"
      :class="[editor.tool === 'select' && 'tool-btn-active']"
      title="選取工具（V）"
      @click="editor.setTool('select')"
    >
      <MousePointer2 :size="13" />
    </button>
    <button
      class="page-btn"
      :class="[editor.tool === 'text' && 'tool-btn-active']"
      title="文字工具（T）"
      @click="editor.setTool('text')"
    >
      <Type :size="13" />
    </button>
    <div class="mx-1 h-4 w-px bg-border" />

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

    <div class="flex-1" />

    <select
      class="h-5 max-w-64 min-w-0 rounded border border-input bg-background px-1 text-xs disabled:opacity-50"
      :value="editor.currentFilename ?? ''"
      :disabled="!project.isOpen"
      @change="onSelect"
    >
      <option v-if="!project.isOpen" value="">未開啟專案</option>
      <option v-for="f in project.files" :key="f.filename" :value="f.filename">
        {{ f.filename }}{{ f.labels.length > 0 ? `（${f.labels.length}）` : '' }}
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
  MousePointer2,
  Type,
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

function onSelect(e: Event) {
  editor.selectFile((e.target as HTMLSelectElement).value)
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
.tool-btn-active,
.tool-btn-active:hover:not(:disabled) {
  background: var(--accent);
  color: var(--accent-foreground);
}
</style>
