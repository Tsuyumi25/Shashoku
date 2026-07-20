<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-7 shrink-0 items-center border-t border-b border-border px-2 select-none">
      <span class="text-xs text-muted-foreground">
        {{ selectedIndex >= 0 ? `標號 ${selectedIndex + 1}` : '未選取標籤' }}
      </span>
      <span v-if="selectedLabel" class="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
        <span
          class="inline-block h-2.5 w-2.5 rounded-full"
          :style="{ backgroundColor: selectedGroup?.color ?? 'gray' }"
        />
        {{ selectedGroup?.name ?? '未分組' }}
      </span>
    </div>

    <textarea
      ref="textareaRef"
      class="min-h-0 w-full flex-1 resize-none bg-card px-3 py-2 leading-relaxed focus:outline-none"
      :style="{ fontSize: `${editor.fontSize}px` }"
      :value="selectedLabel?.text ?? ''"
      :disabled="!selectedLabel"
      :placeholder="selectedLabel ? '輸入翻譯…' : ''"
      @input="onInput"
      @focus="onFocus"
      @blur="commitPending"
      @keydown="onKeydown"
    />

    <div class="flex h-6 shrink-0 items-center border-t border-border px-2 select-none">
      <span class="text-xs text-muted-foreground">Ctrl+Enter = 下一個標籤</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const editor = useEditorStore()

const textareaRef = useTemplateRef('textareaRef')

const labels = computed(() =>
  editor.currentFilename ? (project.fileByName(editor.currentFilename)?.labels ?? []) : [],
)
const selectedIndex = computed(() => labels.value.findIndex((l) => l.id === editor.selectedLabelId))
const selectedLabel = computed(() =>
  selectedIndex.value >= 0 ? labels.value[selectedIndex.value] : undefined,
)
const selectedGroup = computed(() => {
  const gid = selectedLabel.value?.groupId
  if (!gid) return undefined
  return project.header.groups.find((g) => g.id === gid)
})

// 原版打字即時寫入 store；undo 粒度為「一次編輯段落」：
// focus / 切換標籤時記下舊值，blur / 切換時 diff 提交一筆 command（lazy-do）
let pending: { filename: string; labelId: string; oldText: string } | null = null

function beginEditing() {
  if (!selectedLabel.value || !editor.currentFilename) return
  pending = {
    filename: editor.currentFilename,
    labelId: selectedLabel.value.id,
    oldText: selectedLabel.value.text,
  }
}

function commitPending() {
  if (!pending) return
  const label = project.fileByName(pending.filename)?.labels.find((l) => l.id === pending!.labelId)
  if (label && label.text !== pending.oldText) {
    const { filename, labelId, oldText } = pending
    const newText = label.text
    editor.pushCommand(
      {
        label: `update-text ${labelId}`,
        do: () => project.updateLabelText(filename, labelId, newText),
        undo: () => project.updateLabelText(filename, labelId, oldText),
      },
      { alreadyApplied: true },
    )
  }
  pending = null
}

function onFocus() {
  if (!pending) beginEditing()
}

function onInput(e: Event) {
  if (!selectedLabel.value || !editor.currentFilename) return
  if (!pending) beginEditing()
  project.updateLabelText(
    editor.currentFilename,
    selectedLabel.value.id,
    (e.target as HTMLTextAreaElement).value,
  )
}

// 切換選中標籤：先提交上一個的編輯段落
watch(
  () => editor.selectedLabelId,
  () => {
    commitPending()
  },
)

// 點 marker 聚焦編輯框（原版 textbox.Focus()）
watch(
  () => editor.focusEditorRequest,
  async () => {
    await nextTick()
    textareaRef.value?.focus()
    // 游標移到末尾（原版 SelectionStart = length）
    const el = textareaRef.value
    if (el) el.setSelectionRange(el.value.length, el.value.length)
  },
)

/** 文字框快捷鍵:Esc 回操作層(modal);Ctrl+Enter / Ctrl+↑↓ 切標籤、Ctrl+←→ 換頁 */
function onKeydown(e: KeyboardEvent) {
  // Esc = blur 回操作層。IME 組字中的 Esc 是取消組字,不攔;
  // stopPropagation:blur 後這顆 Esc 別漏到 window 層被算進「連按重置視角」
  if (e.key === 'Escape') {
    if (e.isComposing) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLTextAreaElement).blur()
    return
  }
  if (!(e.ctrlKey || e.metaKey)) return
  if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault()
    editor.selectLabelBy(e.key === 'Enter' && e.shiftKey ? -1 : 1) // Ctrl+Shift+Enter = 上一個
    editor.requestEditorFocus()
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    editor.selectLabelBy(-1)
    editor.requestEditorFocus()
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault()
    editor.pageBy(-1)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    editor.pageBy(1)
  }
}
</script>
