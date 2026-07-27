import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { LabelItem } from '@/types/project'
import { useZoomPan, type Size } from '@/composables/useZoomPan'
import { useProjectStore } from '@/stores/projectStore'
import { screenToPageFraction } from '@/lib/coords'
import { generateId as generateLabelId } from '@shared/page/schema'

export interface Command {
  
  label: string
  do(): void
  undo(): void
}

/**
 * Sticky, as in Photoshop: the text tool stays until V takes it back. The
 * canvas's other gestures are held rather than toggled, which is why the
 * bottom bar has to say which tool is up — a cursor shape is gone the moment
 * the pointer leaves the canvas.
 */
export type CanvasTool = 'select' | 'text'


export const useEditorStore = defineStore('editor', () => {
  const currentFilename = ref<string | null>(null)
  const selectedLabelId = ref<string | null>(null)
  const tool = ref<CanvasTool>('select')
  
  const activeGroupId = ref<string | null>(null)
  
  const showGroups = ref(false)
  
  const focusEditorRequest = ref(0)
  
  const fontSize = ref(14)

  function adjustFontSize(delta: number) {
    fontSize.value = Math.min(24, Math.max(10, fontSize.value + delta))
  }

  function setTool(next: CanvasTool) {
    tool.value = next
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
    commitTextEdit()
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

  /**
   * The translation being typed right now. Every keystroke writes straight
   * through so the page keeps up, and the editing session is what enters the
   * undo stack — the same split the drag gestures use. One entry per label you
   * visited reads as "you edited this line", where a time window would let
   * typing speed decide how much an undo takes back.
   */
  const pendingTextEdit = ref<{ filename: string; labelId: string; from: string } | null>(null)

  /** Undefined once the label being edited has been deleted under the caret. */
  function textOfPending(): string | undefined {
    const pending = pendingTextEdit.value
    if (!pending) return undefined
    const project = useProjectStore()
    return project.fileByName(pending.filename)?.labels.find((l) => l.id === pending.labelId)?.text
  }

  function beginTextEdit(filename: string, labelId: string, from: string) {
    commitTextEdit()
    pendingTextEdit.value = { filename, labelId, from }
  }

  function commitTextEdit() {
    const pending = pendingTextEdit.value
    if (!pending) return
    const text = textOfPending()
    // Cleared first: the command below re-enters here through pushCommand, and
    // this is what stops it recursing.
    pendingTextEdit.value = null
    // The label was deleted mid-edit, and the delete already captured its text.
    if (text === undefined) return
    cmdUpdateLabelText(pending.filename, pending.labelId, pending.from, text)
  }

  /**
   * Bank what has been typed without ending the visit, for a save that lands
   * mid-sentence: the undo stack has to agree with what went to disk, and the
   * caret is still in the box.
   */
  function flushTextEdit() {
    const pending = pendingTextEdit.value
    const text = textOfPending()
    commitTextEdit()
    if (!pending || text === undefined) return
    pendingTextEdit.value = { ...pending, from: text }
  }

  /**
   * Every command lands here, so this is where an open text edit is closed:
   * the stack has to run in the order things happened, or undoing a delete
   * after the text change it swallowed replays them the wrong way round.
   */
  function pushCommand(cmd: Command, opts?: { alreadyApplied?: boolean }) {
    commitTextEdit()
    if (!opts?.alreadyApplied) cmd.do()
    undoStack.value = [...undoStack.value, cmd]
    redoStack.value = []
  }

  /**
   * Closed before the stack is read, not after: a session still open is the
   * most recent thing that happened, so it is what an undo has to take back.
   * Reading the stack first would reach past it to some earlier command and
   * leave the typing standing.
   */
  function undo() {
    commitTextEdit()
    const cmd = undoStack.value.at(-1)
    if (!cmd) return
    undoStack.value = undoStack.value.slice(0, -1)
    cmd.undo()
    redoStack.value = [...redoStack.value, cmd]
  }

  /** Typing after an undo ends the redo branch, as it does in any editor. */
  function redo() {
    commitTextEdit()
    const cmd = redoStack.value.at(-1)
    if (!cmd) return
    redoStack.value = redoStack.value.slice(0, -1)
    cmd.do()
    undoStack.value = [...undoStack.value, cmd]
  }

  
  function clearHistory() {
    undoStack.value = []
    redoStack.value = []
    pendingTextEdit.value = null
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

  /**
   * A new label is empty and joins the active group, so a run of them can be
   * placed first and typed later. It goes on the end because the order of
   * `labels[]` is the numbering, and inserting near the pointer would renumber
   * the page under whoever is reading it.
   */
  function addLabelAt(x: number, y: number) {
    if (!currentFilename.value) return
    cmdAddLabel(currentFilename.value, {
      id: generateLabelId(),
      x,
      y,
      groupId: activeGroupId.value,
      text: '',
    })
  }

  /**
   * Where the panel's add button drops a label. The view centre is a container
   * coordinate, which is what `screenToPageFraction` wants once the container's
   * own offset is taken out — and it can be off the page after a pan, hence the
   * clamp inside it.
   */
  function addLabelAtViewCenter() {
    const natural = viewContentSize.value
    if (!natural.w || !natural.h) return
    const p = screenToPageFraction(
      viewContainerSize.value.w / 2,
      viewContainerSize.value.h / 2,
      { left: 0, top: 0 },
      view,
      natural,
    )
    addLabelAt(p.x, p.y)
  }

  function deleteSelectedLabel() {
    if (!currentFilename.value || !selectedLabelId.value) return
    cmdDeleteLabel(currentFilename.value, selectedLabelId.value)
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
    tool,
    setTool,
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
    beginTextEdit,
    commitTextEdit,
    flushTextEdit,
    pushCommand,
    undo,
    redo,
    clearHistory,
    addLabelAt,
    addLabelAtViewCenter,
    deleteSelectedLabel,
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
