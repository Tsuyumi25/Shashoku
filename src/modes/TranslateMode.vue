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

    <!-- ? = 快捷鍵說明(操作層) -->
    <Dialog v-model:open="helpOpen">
      <DialogContent class="max-h-[85vh] !max-w-4xl overflow-y-auto p-8">
        <DialogHeader>
          <DialogTitle class="text-lg">翻譯 mode 操作一覽</DialogTitle>
          <DialogDescription>操作層 = 譯文框未聚焦；i / Enter 進輸入層，Esc 回來</DialogDescription>
        </DialogHeader>
        <div class="mt-2 grid grid-cols-2 gap-x-12 gap-y-8 text-sm">
          <section v-for="sec in HELP_SECTIONS" :key="sec.title">
            <h4 class="mb-3 border-b border-border pb-1.5 text-sm font-semibold text-muted-foreground">
              {{ sec.title }}
            </h4>
            <ul class="flex flex-col gap-2.5">
              <li v-for="row in sec.rows" :key="row[1]" class="flex items-baseline justify-between gap-4">
                <span class="shrink-0"><kbd class="help-kbd">{{ row[0] }}</kbd></span>
                <span class="text-right text-muted-foreground">{{ row[1] }}</span>
              </li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import CanvasView from '@/components/CanvasView.vue'
import LabelTable from '@/components/LabelTable.vue'
import TranslateEditor from '@/components/TranslateEditor.vue'
import TranslateSidebar from '@/components/TranslateSidebar.vue'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { appMode } from '@/lib/appMode'
import { useEditorStore } from '@/stores/editorStore'

const editor = useEditorStore()

// ── ? 快捷鍵說明 ──
const helpOpen = ref(false)

const HELP_SECTIONS: { title: string; rows: [string, string][] }[] = [
  {
    title: '操作層(鍵盤)',
    rows: [
      ['j / ↓ · k / ↑', '下/上一個標籤(到頁界自動換頁)'],
      ['i · Enter', '編輯譯文(進輸入層)'],
      ['dd · Delete', '刪除選中標籤'],
      ['Ctrl+Enter(+Shift)', '下(上)一個標籤並編輯'],
      ['Ctrl+Z', '復原'],
      ['Ctrl+Shift+Z · Ctrl+Y', '重做'],
      ['?', '本說明'],
    ],
  },
  {
    title: '輸入層(譯文框)',
    rows: [
      ['Esc', '回操作層'],
      ['Ctrl+Enter · Ctrl+↓', '下一個並繼續編輯'],
      ['Ctrl+Shift+Enter · Ctrl+↑', '上一個並繼續編輯'],
      ['Ctrl+← · Ctrl+→', '換頁'],
    ],
  },
  {
    title: '滑鼠',
    rows: [
      ['點空白', '新增標籤'],
      ['點 marker · 拖 marker', '選取 · 移動'],
      ['雙擊 marker', '編輯譯文'],
      ['右鍵 marker', '刪除'],
      ['拖空白 · 滾輪', '平移 · 縮放(游標錨定)'],
      ['中鍵', '下一頁'],
    ],
  },
  {
    title: '視角與全域',
    rows: [
      ['← / → / Tab', '換頁'],
      ['0', '適應視窗'],
      ['R 按住+拖曳', '旋轉視角(Shift 吸附 15°)'],
      ['Esc 連按兩下', '重置視角'],
      ['Shift+Tab', '切換 mode(翻譯→嵌字→校對)'],
      ['Ctrl+S', '存檔'],
    ],
  },
]

// ── 翻譯 mode 全域快捷鍵 + modal 鍵盤層的操作層 ──
// 兩層 modal(vim 式):操作層 = 譯文框未聚焦,按鍵是命令;輸入層 = 聚焦,
// i 進、Esc 回(Esc 在 TranslateEditor)。滑鼠不分層,隨時可直接操作。
// 「畫布自動跟蹤選中標籤」在 CanvasView 常駐,j/k 導航時視野跟著走。

// dd 之類的序列鍵:600ms 內等第二鍵,逾時歸零
let pendingKey: string | null = null
let pendingTimer: ReturnType<typeof setTimeout> | undefined
function setPendingKey(k: string | null) {
  pendingKey = k
  clearTimeout(pendingTimer)
  if (k !== null) pendingTimer = setTimeout(() => (pendingKey = null), 600)
}

function deleteCurrent() {
  if (editor.selectedLabelId && editor.currentFilename) {
    editor.cmdDeleteLabel(editor.currentFilename, editor.selectedLabelId)
  }
}

useEventListener(window, 'keydown', (e) => {
  if (appMode.value !== 'translate') return // 嵌字 mode 有自己的工具單鍵,互不越界
  const inEditable =
    document.activeElement instanceof HTMLInputElement ||
    document.activeElement instanceof HTMLTextAreaElement
  // 輸入層:其餘快捷鍵交給原生行為 / 文字框自己的 handler
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
  // Ctrl+Enter(操作層)= 下一個標籤並進輸入層;+Shift = 上一個——
  // 與輸入層語義統一:「下/上一個,並且我要打字」
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    editor.selectLabelBy(e.shiftKey ? -1 : 1)
    editor.requestEditorFocus()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return

  // ── 操作層命令 ──
  const key = e.key
  if (key === 'd') {
    if (pendingKey === 'd') {
      setPendingKey(null)
      deleteCurrent() // dd = 刪除當前標籤(vim 刪行)
    } else {
      setPendingKey('d')
    }
    return
  }
  setPendingKey(null) // 任何其他鍵打斷序列
  if (key === 'j' || key === 'ArrowDown') {
    e.preventDefault()
    editor.selectLabelBy(1)
    return
  }
  if (key === 'k' || key === 'ArrowUp') {
    e.preventDefault()
    editor.selectLabelBy(-1)
    return
  }
  if (key === 'i' || key === 'Enter') {
    e.preventDefault() // 不讓按鍵本身落進剛聚焦的 textarea
    editor.requestEditorFocus()
    return
  }
  if (key === '?') {
    helpOpen.value = !helpOpen.value
    return
  }
  if (key === 'Delete') {
    e.preventDefault()
    deleteCurrent()
  }
})
</script>

<style scoped>
.help-kbd {
  border-radius: 0.3125rem;
  border: 1px solid var(--border);
  background: var(--accent);
  padding: 0.125rem 0.5rem;
  font-size: 13px;
  color: var(--accent-foreground);
  white-space: nowrap;
}
</style>
