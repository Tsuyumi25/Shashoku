import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { LabelItem } from '@/types/project'
import { useZoomPan, type Size } from '@/composables/useZoomPan'
import { useProjectStore } from '@/stores/projectStore'

export interface Command {
  
  label: string
  do(): void
  undo(): void
}


export const useEditorStore = defineStore('editor', () => {
  const currentFilename = ref<string | null>(null)
  const selectedLabelId = ref<string | null>(null)
  
  const activeGroupId = ref<string | null>(null)
  
  const showGroups = ref(false)
  
  const focusEditorRequest = ref(0)
  
  const fontSize = ref(14)

  function adjustFontSize(delta: number) {
    fontSize.value = Math.min(24, Math.max(10, fontSize.value + delta))
  }

  /**
   * The view transform lives here rather than in the canvas because the bottom
   * bar is the canvas's sibling, and because whether a page change keeps the
   * current view is the same kind of question as which page is open.
   */
  const viewContainerSize = ref<Size>({ w: 0, h: 0 })
  const viewContentSize = ref<Size>({ w: 0, h: 0 })
  const { view, fitToView, wheelZoom, zoomBy, panBy, rotateTo } = useZoomPan(
    viewContainerSize,
    viewContentSize,
  )
  /** The page the view was last fitted to, so re-decoding one does not refit. */
  const viewFittedPage = ref<string | null>(null)

  const undoStack = shallowRef<Command[]>([])
  const redoStack = shallowRef<Command[]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function selectFile(filename: string | null) {
    currentFilename.value = filename
    
    const project = useProjectStore()
    selectedLabelId.value = filename
      ? (project.fileByName(filename)?.labels[0]?.id ?? null)
      : null
  }

  
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

  
  function selectLabelBy(offset: number) {
    const project = useProjectStore()
    if (!currentFilename.value) return
    const labels = project.fileByName(currentFilename.value)?.labels ?? []
    const index = labels.findIndex((l) => l.id === selectedLabelId.value)
    if (index === -1 && labels.length > 0) {
      selectedLabelId.value = labels[offset > 0 ? 0 : labels.length - 1].id
      return
    }
    
    const next = index + offset
    if (next >= labels.length) pageBy(1)
    else if (next < 0) pageBy(-1, 'last')
    else selectedLabelId.value = labels[next].id
  }

  function requestEditorFocus() {
    focusEditorRequest.value++
  }

  
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

  
  function clearHistory() {
    undoStack.value = []
    redoStack.value = []
  }

  

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

  
  function cmdDuplicateLabel(
    filename: string,
    label: LabelItem,
    opts?: { alreadyApplied?: boolean },
  ) {
    const project = useProjectStore()
    let index: number | undefined
    pushCommand(
      {
        label: `duplicate-label ${label.id}`,
        do: () => project.addLabel(filename, label, index),
        undo: () => {
          index = project.deleteLabel(filename, label.id)
        },
      },
      opts,
    )
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
      
      const labels = project.fileByName(filename)?.labels ?? []
      selectedLabelId.value = labels[Math.min(index, labels.length - 1)]?.id ?? null
    }
  }

  
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

  function cmdUpdateLabelGroupId(
    filename: string,
    labelId: string,
    oldGroupId: string | null,
    newGroupId: string | null,
  ) {
    if (oldGroupId === newGroupId) return
    const project = useProjectStore()
    pushCommand({
      label: `update-groupId ${labelId}`,
      do: () => project.updateLabelGroupId(filename, labelId, newGroupId),
      undo: () => project.updateLabelGroupId(filename, labelId, oldGroupId),
    })
  }

  
  function cmdAddGroup(name: string): boolean {
    const project = useProjectStore()
    const added = project.addGroup(name)
    if (added === null) return false
    pushCommand(
      {
        label: `add-group ${name}`,
        do: () => project.restoreLastGroup(added),
        undo: () => {
          
          project.removeLastGroup()
        },
      },
      { alreadyApplied: true },
    )
    return true
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
    activeGroupId,
    showGroups,
    focusEditorRequest,
    fontSize,
    adjustFontSize,
    view,
    viewContainerSize,
    viewContentSize,
    viewFittedPage,
    fitToView,
    wheelZoom,
    zoomBy,
    panBy,
    rotateTo,
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
    cmdDuplicateLabel,
    cmdDeleteLabel,
    cmdMoveLabel,
    cmdUpdateLabelText,
    cmdUpdateLabelGroupId,
    cmdAddGroup,
    cmdRenameGroup,
  }
})
