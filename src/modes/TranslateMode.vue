<template>
  <div class="flex h-full">
    <!-- 左:工作模式 + 分組 + mode 切換 -->
    <TranslateSidebar />

    <!-- 主區：畫布（含底部換頁列）｜右欄（標籤表格 + 翻譯編輯框） -->
    <main class="flex min-h-0 min-w-0 flex-1">
      <section class="min-w-0 flex-1 border-r border-border">
        <CanvasView />
      </section>
      <aside class="flex shrink-0 flex-col bg-card" style="width: var(--layout-panel-w)">
        <div class="h-[45%] min-h-0">
          <LabelTable />
        </div>
        <div class="min-h-0 flex-1">
          <TranslateEditor />
        </div>
      </aside>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import CanvasView from '@/components/CanvasView.vue'
import LabelTable from '@/components/LabelTable.vue'
import TranslateEditor from '@/components/TranslateEditor.vue'
import TranslateSidebar from '@/components/TranslateSidebar.vue'
import { appMode } from '@/lib/appMode'
import { useEditorStore, type WorkMode } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

// ── 翻譯 mode 全域快捷鍵（原版鍵位；Ctrl+S 存檔升級到 AppShell 全 mode 通用）──
// R 不在這裡:它是 spring-loaded 鍵(按住拖曳 = 旋轉視角、輕點 = 切檢查),
// keydown/keyup 的分流在 CanvasView
const MODE_KEYS: Record<string, WorkMode> = { q: 'browse', w: 'label', e: 'input' }

useEventListener(window, 'keydown', (e) => {
  if (appMode.value !== 'translate') return // 嵌字 mode 有自己的工具單鍵,互不越界
  const inEditable =
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement
  // 輸入框聚焦時，其餘快捷鍵交給原生行為 / 文字框自己的 handler
  if (inEditable) return

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) editor.redo()
    else editor.undo()
    return
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    editor.redo()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return

  // Q/W/E/R 切模式
  const mode = MODE_KEYS[e.key.toLowerCase()]
  if (mode) {
    editor.mode = mode
    return
  }
  // 1-9 切分組
  if (/^[1-9]$/.test(e.key)) {
    const n = Number(e.key)
    if (n <= project.header.groups.length) editor.activeCategory = n
    return
  }
  if (e.key === 'Delete' && editor.selectedLabelId && editor.currentFilename) {
    e.preventDefault()
    editor.cmdDeleteLabel(editor.currentFilename, editor.selectedLabelId)
  }
})
</script>
