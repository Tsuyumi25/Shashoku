import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { GroupLayerEntry, TextLayerEntry } from '@shared/page/types'
import { useZoomPan, type Size } from '@/composables/useZoomPan'
import { useProjectStore, type LabelPlace } from '@/stores/projectStore'
import { screenToPageFraction } from '@/lib/coords'
import { generateId as generateLabelId } from '@shared/page/schema'
import { textOf } from '@shared/page/text'
import type { DropTarget } from '@shared/page/tree'

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

  /**
   * One selection, held as a set with a cursor into it — never two selections
   * that have to be kept in step.
   *
   * The cursor is whichever object was touched last. It is what the canvas
   * turns the page to follow and what a single-object command acts on; the set
   * is what the canvas outlines and what a command over many acts on. An empty
   * selection has no cursor, and the cursor is always in the set otherwise.
   */
  const selectedLabelIds = ref<Set<string>>(new Set())
  const cursorLabelId = ref<string | null>(null)

  function selectOnly(labelId: string | null) {
    cursorLabelId.value = labelId
    selectedLabelIds.value = labelId === null ? new Set() : new Set([labelId])
  }

  function isSelected(labelId: string): boolean {
    return selectedLabelIds.value.has(labelId)
  }

  const tool = ref<CanvasTool>('select')
  
  const activeGroupId = ref<string | null>(null)
  
  const showGroups = ref(false)
  
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
    selectOnly(filename ? (project.labelsOf(filename)[0]?.id ?? null) : null)
  }

  
  function pageBy(offset: number, landOn: 'first' | 'last' = 'first') {
    const project = useProjectStore()
    if (project.files.length === 0) return
    const index = project.files.findIndex((f) => f.filename === currentFilename.value)
    const next = index === -1 ? 0 : index + offset
    if (next < 0 || next >= project.files.length) return
    selectFile(project.files[next].filename)
    if (landOn === 'last') {
      const labels = project.labelsOf(project.files[next].filename)
      selectOnly(labels[labels.length - 1]?.id ?? null)
    }
  }

  
  function selectLabelBy(offset: number) {
    const project = useProjectStore()
    if (!currentFilename.value) return
    const labels = project.labelsOf(currentFilename.value)
    const index = labels.findIndex((l) => l.id === cursorLabelId.value)
    if (index === -1 && labels.length > 0) {
      selectOnly(labels[offset > 0 ? 0 : labels.length - 1].id)
      return
    }
    
    const next = index + offset
    if (next >= labels.length) pageBy(1)
    else if (next < 0) pageBy(-1, 'last')
    else selectOnly(labels[next].id)
  }

  /**
   * Land on an object wherever in the chapter it lives — what clicking a row of
   * the label list does.
   *
   * The view is left alone on purpose: the list is read at the scale of the
   * chapter, and a canvas that scrolled and zoomed itself on every click would
   * make reading down it unbearable. `selectFile` lands on the page's first
   * object, so the one asked for has to be put back after the turn.
   */
  function revealLabel(filename: string, labelId: string) {
    if (currentFilename.value !== filename) selectFile(filename)
    selectOnly(labelId)
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
    const label = project.labelById(pending.filename, pending.labelId)
    return label === undefined ? undefined : textOf(label)
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

  

  function cmdAddLabel(filename: string, label: TextLayerEntry) {
    const project = useProjectStore()
    let place: LabelPlace | undefined
    pushCommand({
      label: `add-label ${label.id}`,
      do: () => project.addLabel(filename, label, place),
      undo: () => {
        place = project.deleteLabel(filename, label.id) ?? undefined
      },
    })
    selectOnly(label.id)
  }

  /**
   * A new label is empty and joins the active group, so a run of them can be
   * placed first and typed later.
   */
  function addLabelAt(x: number, y: number) {
    if (!currentFilename.value) return
    cmdAddLabel(currentFilename.value, {
      kind: 'text',
      id: generateLabelId(),
      visible: true,
      locked: false,
      x,
      y,
      groupId: activeGroupId.value,
      rotation: 0,
      lines: [''],
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
    if (!currentFilename.value || !cursorLabelId.value) return
    cmdDeleteLabel(currentFilename.value, cursorLabelId.value)
  }

  
  function cmdDuplicateLabel(
    filename: string,
    label: TextLayerEntry,
    opts?: { alreadyApplied?: boolean },
  ) {
    const project = useProjectStore()
    let place: LabelPlace | undefined
    pushCommand(
      {
        label: `duplicate-label ${label.id}`,
        do: () => project.addLabel(filename, label, place),
        undo: () => {
          place = project.deleteLabel(filename, label.id) ?? undefined
        },
      },
      opts,
    )
    selectOnly(label.id)
  }

  function cmdDeleteLabel(filename: string, labelId: string) {
    const project = useProjectStore()
    const label = project.labelById(filename, labelId)
    if (!label) return
    let place: LabelPlace | undefined
    pushCommand({
      label: `delete-label ${labelId}`,
      do: () => {
        place = project.deleteLabel(filename, labelId) ?? undefined
      },
      undo: () => project.addLabel(filename, label, place),
    })
    if (isSelected(labelId)) {
      const labels = project.labelsOf(filename)
      const landing = place?.orderIndex ?? labels.length
      selectOnly(labels[Math.min(landing, labels.length - 1)]?.id ?? null)
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


  function cmdRotateLabel(filename: string, labelId: string, from: number, to: number) {
    if (from === to) return
    const project = useProjectStore()
    pushCommand(
      {
        label: `rotate-label ${labelId}`,
        do: () => project.rotateLabel(filename, labelId, to),
        undo: () => project.rotateLabel(filename, labelId, from),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * Both sides are snapshots of one label's override taken moments apart, so a
   * string compare is enough to tell a drag that ended where it started from
   * one that moved — which is what keeps a corner nudged and put back out of
   * the undo stack.
   */
  function cmdUpdateLabelStyleOverride(
    filename: string,
    labelId: string,
    from: TextLayerEntry['styleOverride'],
    to: TextLayerEntry['styleOverride'],
  ) {
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) return
    const project = useProjectStore()
    pushCommand(
      {
        label: `style-override ${labelId}`,
        do: () => project.updateLabelStyleOverride(filename, labelId, to),
        undo: () => project.updateLabelStyleOverride(filename, labelId, from),
      },
      { alreadyApplied: true },
    )
  }

  function cmdAddFolder(filename: string, name: string) {
    const project = useProjectStore()
    const folder: GroupLayerEntry = {
      kind: 'group',
      id: generateLabelId(),
      name,
      visible: true,
      locked: false,
      children: [],
    }
    let path: number[] | undefined
    pushCommand({
      label: `add-folder ${folder.id}`,
      do: () => project.addFolder(filename, folder, path),
      undo: () => {
        const removed = project.dissolveFolder(filename, folder.id)
        path = removed?.path
      },
    })
  }

  /**
   * Dissolving rather than deleting: a folder is pure containment, so taking
   * one away has to leave what it held behind. There is no way to lose a
   * translation by tidying up.
   */
  function cmdDissolveFolder(filename: string, folderId: string) {
    const project = useProjectStore()
    const removed = project.dissolveFolder(filename, folderId)
    if (removed === null) return
    pushCommand(
      {
        label: `dissolve-folder ${folderId}`,
        do: () => project.dissolveFolder(filename, folderId),
        undo: () => project.restoreFolder(filename, removed.path, removed.folder),
      },
      { alreadyApplied: true },
    )
  }

  /**
   * Applied first so a refused drop — a folder aimed into itself — never
   * reaches the stack as an entry that undoes to nothing.
   */
  function cmdMoveLayer(
    filename: string,
    layerId: string,
    fromPath: number[],
    target: DropTarget,
  ) {
    const project = useProjectStore()
    if (!project.moveLayer(filename, fromPath, target)) return
    pushCommand(
      {
        label: `move-layer ${layerId}`,
        do: () => project.moveLayer(filename, fromPath, target),
        undo: () => project.restoreLayerAt(filename, layerId, fromPath),
      },
      { alreadyApplied: true },
    )
  }

  function cmdSetLayerVisible(filename: string, layerId: string, visible: boolean) {
    const project = useProjectStore()
    pushCommand({
      label: `set-visible ${layerId}`,
      do: () => project.setLayerVisible(filename, layerId, visible),
      undo: () => project.setLayerVisible(filename, layerId, !visible),
    })
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
    selectedLabelIds,
    cursorLabelId,
    selectOnly,
    isSelected,
    tool,
    setTool,
    activeGroupId,
    showGroups,
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
    revealLabel,
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
    cmdRotateLabel,
    cmdUpdateLabelStyleOverride,
    cmdAddFolder,
    cmdDissolveFolder,
    cmdMoveLayer,
    cmdSetLayerVisible,
    cmdUpdateLabelText,
    cmdUpdateLabelGroupId,
    cmdAddGroup,
    cmdRenameGroup,
  }
})
