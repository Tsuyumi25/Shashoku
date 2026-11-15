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

    <div class="absolute left-1/2 flex max-w-[40%] -translate-x-1/2 justify-center">
      <FaceSwitch />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  Maximize,
  Tag,
  ZoomIn,
  ZoomOut,
} from '@lucide/vue'
import FaceSwitch from '@/components/FaceSwitch.vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const percentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
})
const scalePercent = computed(() => percentFormat.format(editor.view.scale))
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
.page-btn-on {
  background: var(--secondary);
  color: var(--primary);
}
</style>
