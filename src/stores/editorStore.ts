import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { LabelItem } from '@/types/project'
import { useProjectStore } from '@/stores/projectStore'

export interface Command {
  /** debug 用途的人話描述 */
  label: string
  do(): void
  undo(): void
}

/**
 * 暫態 UI 狀態 + undo/redo 協調。
 * projectStore 只做純資料操作，所有進 undo 棧的變更都經由這裡的 cmd* action 包裝。
 */
export const useEditorStore = defineStore('editor', () => {
  const currentFilename = ref<string | null>(null)
  const selectedLabelId = ref<string | null>(null)
  /** 新增 label 時使用的分組（1~9） */
  const activeCategory = ref(1)
  /** 畫布 marker 旁常駐顯示分組名。原版檢查模式的 AlwaysShowGroup——工作
   * 模式退場後,它是顯示偏好不是工作階段,降級為 toggle。 */
  const showGroups = ref(false)
  /** 遞增即請求翻譯編輯框聚焦（點 marker 後聚焦文字框的原版行為） */
  const focusEditorRequest = ref(0)
  /** 右欄表格/編輯框字級（原版 F+ / F-） */
  const fontSize = ref(14)

  function adjustFontSize(delta: number) {
    fontSize.value = Math.min(24, Math.max(10, fontSize.value + delta))
  }

  const undoStack = shallowRef<Command[]>([])
  const redoStack = shallowRef<Command[]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function selectFile(filename: string | null) {
    currentFilename.value = filename
    // 原版換頁後自動選第一個 label
    const project = useProjectStore()
    selectedLabelId.value = filename
      ? (project.fileByName(filename)?.labels[0]?.id ?? null)
      : null
  }

  /** 換頁：offset ±1（原版 ←/→/Tab/中鍵/Ctrl+←→）。landOn 決定落點選中哪個 label——
   * 向上跨頁(倒著走)要落在前頁最後一個,才接得上 item 流 */
  function pageBy(offset: number, landOn: 'first' | 'last' = 'first') {
    const project = useProjectStore()
    if (project.files.length === 0) return
    const index = project.files.findIndex((f) => f.filename === currentFilename.value)
    const next = index === -1 ? 0 : index + offset
    if (next < 0 || next >= project.files.length) return
    selectFile(project.files[next].filename)
    if (landOn === 'last') {
      const labels = project.files[next].labels
      selectedLabelId.value = labels[labels.length - 1]?.id ?? null
    }
  }

  /** 切選中 label：offset ±1（原版 Ctrl+Enter / Ctrl+↑↓）。
   * 到頁界跨頁——item 流的全序跨頁存在,空頁也是一站(不跳,跳頁不直覺) */
  function selectLabelBy(offset: number) {
    const project = useProjectStore()
    if (!currentFilename.value) return
    const labels = project.fileByName(currentFilename.value)?.labels ?? []
    const index = labels.findIndex((l) => l.id === selectedLabelId.value)
    if (index === -1 && labels.length > 0) {
      selectedLabelId.value = labels[offset > 0 ? 0 : labels.length - 1].id
      return
    }
    // 空頁時 index = -1:向下 next = 0 ≥ 0 = length、向上 next = -2 < 0,兩邊都正確跨頁
    const next = index + offset
    if (next >= labels.length) pageBy(1)
    else if (next < 0) pageBy(-1, 'last')
    else selectedLabelId.value = labels[next].id
  }

  function requestEditorFocus() {
    focusEditorRequest.value++
  }

  /**
   * @param alreadyApplied 變更已在外部即時套用（如拖曳過程直接 mutate），
   *   push 時跳過首次 do()；redo 時仍會執行 do()，所以 do 必須是完整套用而非 no-op
   */
  function pushCommand(cmd: Command, opts?: { alreadyApplied?: boolean }) {
    if (!opts?.alreadyApplied) cmd.do()
    undoStack.value = [...undoStack.value, cmd]
    redoStack.value = []
  }

  function undo() {
    const cmd = undoStack.value.at(-1)
    if (!cmd) return
    undoStack.value = undoStack.value.slice(0, -1)
    cmd.undo()
    redoStack.value = [...redoStack.value, cmd]
  }

  function redo() {
    const cmd = redoStack.value.at(-1)
    if (!cmd) return
    redoStack.value = redoStack.value.slice(0, -1)
    cmd.do()
    undoStack.value = [...undoStack.value, cmd]
  }

  /** 換工程時清空：命令閉包持有的是舊工程的 label 參照 */
  function clearHistory() {
    undoStack.value = []
    redoStack.value = []
  }

  // ── command 工廠：綁定 projectStore 的資料操作 ──

  function cmdAddLabel(filename: string, label: LabelItem) {
    const project = useProjectStore()
    let index: number | undefined
    pushCommand({
      label: `add-label ${label.id}`,
      do: () => project.addLabel(filename, label, index),
      undo: () => {
        index = project.deleteLabel(filename, label.id)
      },
    })
    selectedLabelId.value = label.id
  }

  function cmdDeleteLabel(filename: string, labelId: string) {
    const project = useProjectStore()
    const label = project.fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    let index = -1
    pushCommand({
      label: `delete-label ${labelId}`,
      do: () => {
        index = project.deleteLabel(filename, labelId)
      },
      undo: () => project.addLabel(filename, label, index),
    })
    if (selectedLabelId.value === labelId) {
      // vim 刪行語義:游標落到下一個(沒有則上一個)——維持「永遠有選中」
      const labels = project.fileByName(filename)?.labels ?? []
      selectedLabelId.value = labels[Math.min(index, labels.length - 1)]?.id ?? null
    }
  }

  /** 拖曳結束時提交：位置已在拖曳過程即時套用（lazy-do） */
  function cmdMoveLabel(
    filename: string,
    labelId: string,
    oldPos: { x: number; y: number },
    newPos: { x: number; y: number },
  ) {
    const project = useProjectStore()
    pushCommand(
      {
        label: `move-label ${labelId}`,
        do: () => project.moveLabel(filename, labelId, newPos.x, newPos.y),
        undo: () => project.moveLabel(filename, labelId, oldPos.x, oldPos.y),
      },
      { alreadyApplied: true },
    )
  }

  function cmdUpdateLabelText(filename: string, labelId: string, oldText: string, newText: string) {
    if (oldText === newText) return
    const project = useProjectStore()
    pushCommand({
      label: `update-text ${labelId}`,
      do: () => project.updateLabelText(filename, labelId, newText),
      undo: () => project.updateLabelText(filename, labelId, oldText),
    })
  }

  function cmdUpdateLabelCategory(
    filename: string,
    labelId: string,
    oldCategory: number,
    newCategory: number,
  ) {
    if (oldCategory === newCategory) return
    const project = useProjectStore()
    pushCommand({
      label: `update-category ${labelId}`,
      do: () => project.updateLabelCategory(filename, labelId, newCategory),
      undo: () => project.updateLabelCategory(filename, labelId, oldCategory),
    })
  }

  function cmdAddGroup(name: string) {
    const project = useProjectStore()
    pushCommand({
      label: `add-group ${name}`,
      do: () => {
        project.addGroup(name)
      },
      undo: () => {
        project.header.groups.pop()
      },
    })
  }

  function cmdRenameGroup(index: number, oldName: string, newName: string) {
    if (oldName === newName) return
    const project = useProjectStore()
    pushCommand({
      label: `rename-group ${index}`,
      do: () => project.renameGroup(index, newName),
      undo: () => project.renameGroup(index, oldName),
    })
  }

  return {
    currentFilename,
    selectedLabelId,
    activeCategory,
    showGroups,
    focusEditorRequest,
    fontSize,
    adjustFontSize,
    canUndo,
    canRedo,
    selectFile,
    pageBy,
    selectLabelBy,
    requestEditorFocus,
    pushCommand,
    undo,
    redo,
    clearHistory,
    cmdAddLabel,
    cmdDeleteLabel,
    cmdMoveLabel,
    cmdUpdateLabelText,
    cmdUpdateLabelCategory,
    cmdAddGroup,
    cmdRenameGroup,
  }
})
