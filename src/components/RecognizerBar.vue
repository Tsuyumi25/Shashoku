<template>
  <!--
    Not in the tool rail because none of these is a tool: nothing is armed by
    pressing one. They are actions, which is what this board holds — though
    what they produce reads out a column away, in the source list.
  -->
  <div class="shrink-0 border-b border-border">
    <div class="board-head">
      <span class="text-xs font-medium">辨識器</span>
    </div>

    <div class="p-2">
      <div class="flex flex-wrap items-center gap-1">
        <button
          v-for="(route, index) in routes"
          :key="route.name"
          type="button"
          class="route-btn"
          :class="[
            ocr.showing(route.name) && 'route-btn-on',
            route.busy && 'route-btn-busy',
            `route-btn-${index}`,
          ]"
          :disabled="route.busy || !currentFile"
          :title="route.title"
          @click="press(route.name)"
        >
          <LoaderCircle v-if="route.busy" :size="12" class="animate-spin" />
          <span>{{ route.label }}</span>
          <span v-if="route.read" class="route-count">{{ route.read }}</span>
        </button>
        <div class="flex-1" />
        <!--
          It throws away a whole page's worth, and a button that destructive
          belongs next to the thing that produced them, not next to one.
        -->
        <button
          v-if="pageId && pool.length"
          type="button"
          class="route-btn"
          title="清掉這一頁所有 OCR 結果和已經跑過的偵測，讓下一次按鈕從頭來過"
          @click="ocr.forget(pageId)"
        >
          <Trash2 :size="11" />
          <span>清空 OCR</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { LoaderCircle, Trash2 } from '@lucide/vue'
import { useEditorStore } from '@/stores/editorStore'
import { OCR_ROUTES, useOcrStore, type OcrRoute } from '@/stores/ocrStore'
import { useProjectStore } from '@/stores/projectStore'

const editor = useEditorStore()
const project = useProjectStore()
const ocr = useOcrStore()

const pageId = computed(() => editor.currentPageId)

const pool = computed(() => (pageId.value ? project.readingsOfPage(pageId.value) : []))

const currentFile = computed(() =>
  pageId.value ? (project.pageById(pageId.value) ?? null) : null,
)

/**
 * The count beside a button is the visible form of "this has run" — what
 * tells a reader that pressing again will not re-read.
 */
const routes = computed(() => {
  const labels: Record<string, [string, string]> = {
    'manga-ocr': ['manga-ocr', '兩個偵測器找到的所有文字區域 → manga-ocr 讀整塊'],
    'ppocr-v6': ['PP-OCR 逐欄', 'PP-OCR 自己找文字欄 → 逐欄讀 → 用文字區域合回句子（只讀印刷體）'],
    'baberu-ocr': ['Baberu', '兩個偵測器找到的所有文字區域 → Baberu 讀整塊'],
    'hayai-ocr-v2': ['Hayai', '兩個偵測器找到的所有文字區域 → Hayai 讀整塊（保留原長寬比，擬聲詞較強）'],
  }
  return OCR_ROUTES.map((name) => ({
    name,
    label: labels[name][0],
    title: labels[name][1],
    busy: ocr.busy(name),
    read: pool.value.filter((c) => c.source === name).length,
  }))
})

function press(route: OcrRoute) {
  const file = currentFile.value
  if (!file) return
  void ocr.toggleRoute(
    route,
    file.pageId,
    file.pageDir,
    file.page.layers,
    pool.value.some((c) => c.source === route),
  )
}
</script>

<style scoped>
.board-head {
  display: flex;
  height: 1.75rem;
  flex-shrink: 0;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding-left: 0.5rem;
  user-select: none;
}

.route-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  border: 1px solid var(--border);
  padding: 0.125rem 0.375rem;
  font-size: 11px;
  color: var(--muted-foreground);
}
.route-btn:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.route-btn:disabled {
  opacity: 0.5;
}
/* On means its boxes are on the artwork, so each one wears the colour it draws
   them in — the legend and the switch are the same object. */
.route-btn-on {
  color: var(--foreground);
}
.route-btn-on.route-btn-0 {
  border-color: oklch(0.65 0.2 25);
  background: color-mix(in srgb, oklch(0.65 0.2 25) 16%, transparent);
}
.route-btn-on.route-btn-1 {
  border-color: oklch(0.7 0.18 145);
  background: color-mix(in srgb, oklch(0.7 0.18 145) 16%, transparent);
}
.route-btn-on.route-btn-2 {
  border-color: oklch(0.75 0.17 85);
  background: color-mix(in srgb, oklch(0.75 0.17 85) 16%, transparent);
}
.route-btn-on.route-btn-3 {
  border-color: oklch(0.65 0.19 285);
  background: color-mix(in srgb, oklch(0.65 0.19 285) 16%, transparent);
}
.route-count {
  color: var(--muted-foreground);
  font-variant-numeric: tabular-nums;
}
</style>
