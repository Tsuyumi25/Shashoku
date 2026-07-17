<template>
  <!-- 畫布底部列(兩視圖共用):縮放(左)+ 檔案切換(右)。
       頁游標是全域 editorStore,兩個 mode 換頁互相跟隨 -->
  <div class="flex h-7 shrink-0 items-center gap-1 border-t border-border bg-card px-1 select-none">
    <button class="page-btn" title="縮小" @click="emit('zoomBy', 1 / 1.25)">
      <ZoomOut :size="14" />
    </button>
    <button class="page-btn" title="放大" @click="emit('zoomBy', 1.25)">
      <ZoomIn :size="14" />
    </button>
    <span class="px-1 text-xs text-muted-foreground tabular-nums">
      {{ Math.round(scale * 100) }}%
    </span>
    <button class="page-btn" title="適應視窗" @click="emit('fit')">
      <Maximize :size="13" />
    </button>

    <div class="flex-1" />

    <select
      class="h-5 max-w-64 min-w-0 rounded border border-input bg-background px-1 text-xs"
      :value="editor.currentFilename ?? ''"
      @change="onFileSelect"
    >
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
import { ChevronLeft, ChevronRight, Maximize, ZoomIn, ZoomOut } from '@lucide/vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

defineProps<{ scale: number }>()

const emit = defineEmits<{
  zoomBy: [factor: number]
  fit: []
}>()

const project = useProjectStore()
const editor = useEditorStore()

function onFileSelect(e: Event) {
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
.page-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
</style>
