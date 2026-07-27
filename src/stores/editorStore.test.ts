import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'
import type { LabelItem } from '@/types/project'

const PAGE = 'p001.png'

function label(id: string, text = ''): LabelItem {
  return { id, x: 0.5, y: 0.5, groupId: null, text }
}

function openOnePage(labels: LabelItem[] = []) {
  const project = useProjectStore()
  project.files = [{ filename: PAGE, pageDir: `/x/${PAGE}`, labels, badge: 'ok' }]
  const editor = useEditorStore()
  editor.currentFilename = PAGE
  return { project, editor }
}

function labelsOf(project: ReturnType<typeof useProjectStore>): LabelItem[] {
  return project.fileByName(PAGE)?.labels ?? []
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('canvas tool', () => {
  it('starts on select and switches both ways', () => {
    const editor = useEditorStore()
    expect(editor.tool).toBe('select')
    editor.setTool('text')
    expect(editor.tool).toBe('text')
    editor.setTool('select')
    expect(editor.tool).toBe('select')
  })
})

describe('addLabelAt', () => {
  it('appends an empty label carrying the active group, and selects it', () => {
    const { project, editor } = openOnePage([label('a')])
    editor.activeGroupId = 'grp-1'

    editor.addLabelAt(0.25, 0.75)

    const added = labelsOf(project).at(-1)
    expect(labelsOf(project)).toHaveLength(2)
    expect(added).toMatchObject({ x: 0.25, y: 0.75, groupId: 'grp-1', text: '' })
    expect(editor.selectedLabelId).toBe(added?.id)
  })

  it('does nothing without a page open', () => {
    const { project, editor } = openOnePage()
    editor.currentFilename = null
    editor.addLabelAt(0.5, 0.5)
    expect(labelsOf(project)).toHaveLength(0)
  })

  it('undoes back off the page and redoes into the same slot', () => {
    const { project, editor } = openOnePage([label('a'), label('b')])
    editor.addLabelAt(0.1, 0.1)
    const id = labelsOf(project).at(-1)?.id

    editor.undo()
    expect(labelsOf(project).map((l) => l.id)).toEqual(['a', 'b'])

    editor.redo()
    expect(labelsOf(project).map((l) => l.id)).toEqual(['a', 'b', id])
  })
})

describe('addLabelAtViewCenter', () => {
  it('lands on the middle of the page when the page is fitted', () => {
    const { project, editor } = openOnePage()
    editor.viewContainerSize = { w: 800, h: 600 }
    editor.viewContentSize = { w: 400, h: 300 }
    editor.fitToView()

    editor.addLabelAtViewCenter()

    const added = labelsOf(project).at(-1)
    expect(added?.x).toBeCloseTo(0.5, 6)
    expect(added?.y).toBeCloseTo(0.5, 6)
  })

  it('clamps onto the page when the view has been panned off it', () => {
    const { project, editor } = openOnePage()
    editor.viewContainerSize = { w: 800, h: 600 }
    editor.viewContentSize = { w: 400, h: 300 }
    editor.fitToView()
    editor.panBy(-5000, -5000)

    editor.addLabelAtViewCenter()

    expect(labelsOf(project).at(-1)).toMatchObject({ x: 1, y: 1 })
  })

  it('does nothing before a page has been measured', () => {
    const { project, editor } = openOnePage()
    editor.viewContainerSize = { w: 800, h: 600 }
    editor.viewContentSize = { w: 0, h: 0 }
    editor.addLabelAtViewCenter()
    expect(labelsOf(project)).toHaveLength(0)
  })
})

describe('deleteSelectedLabel', () => {
  it('removes the selection and lands on the label that took its place', () => {
    const { project, editor } = openOnePage([label('a'), label('b'), label('c')])
    editor.selectedLabelId = 'b'

    editor.deleteSelectedLabel()

    expect(labelsOf(project).map((l) => l.id)).toEqual(['a', 'c'])
    expect(editor.selectedLabelId).toBe('c')
  })

  it('undoes back into the slot it was deleted from', () => {
    const { project, editor } = openOnePage([label('a'), label('b'), label('c')])
    editor.selectedLabelId = 'b'
    editor.deleteSelectedLabel()

    editor.undo()

    expect(labelsOf(project).map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('does nothing with no selection', () => {
    const { project, editor } = openOnePage([label('a')])
    editor.selectedLabelId = null
    editor.deleteSelectedLabel()
    expect(labelsOf(project)).toHaveLength(1)
    expect(editor.canUndo).toBe(false)
  })
})

describe('pending text edit', () => {
  it('turns one editing session into one undo entry', () => {
    const { project, editor } = openOnePage([label('a', 'before')])
    editor.beginTextEdit(PAGE, 'a', 'before')
    project.updateLabelText(PAGE, 'a', 'b')
    project.updateLabelText(PAGE, 'a', 'be')
    project.updateLabelText(PAGE, 'a', 'bee')
    editor.commitTextEdit()

    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(labelsOf(project)[0].text).toBe('before')
    expect(editor.canUndo).toBe(false)
  })

  it('records nothing when the text came back unchanged', () => {
    const { project, editor } = openOnePage([label('a', 'same')])
    editor.beginTextEdit(PAGE, 'a', 'same')
    project.updateLabelText(PAGE, 'a', 'typed')
    project.updateLabelText(PAGE, 'a', 'same')
    editor.commitTextEdit()
    expect(editor.canUndo).toBe(false)
  })

  it('commits the previous session when a new one begins', () => {
    const { project, editor } = openOnePage([label('a', 'a0'), label('b', 'b0')])
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')
    editor.beginTextEdit(PAGE, 'b', 'b0')
    project.updateLabelText(PAGE, 'b', 'b1')
    editor.commitTextEdit()

    editor.undo()
    expect(labelsOf(project).map((l) => l.text)).toEqual(['a1', 'b0'])
    editor.undo()
    expect(labelsOf(project).map((l) => l.text)).toEqual(['a0', 'b0'])
  })

  it('keeps the stack in the order things happened', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')
    editor.selectedLabelId = 'a'
    editor.deleteSelectedLabel()

    expect(labelsOf(project)).toHaveLength(0)
    editor.undo()
    expect(labelsOf(project)[0].text).toBe('a1')
    editor.undo()
    expect(labelsOf(project)[0].text).toBe('a0')
  })

  it('flushes what has been typed and keeps the visit open', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')
    editor.flushTextEdit()
    project.updateLabelText(PAGE, 'a', 'a2')
    editor.commitTextEdit()

    editor.undo()
    expect(labelsOf(project)[0].text).toBe('a1')
    editor.undo()
    expect(labelsOf(project)[0].text).toBe('a0')
  })

  it('drops a session whose label is gone', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.deleteLabel(PAGE, 'a')
    editor.commitTextEdit()
    expect(editor.canUndo).toBe(false)
  })

  it('is dropped along with the rest of the history', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')
    editor.clearHistory()
    editor.commitTextEdit()
    expect(editor.canUndo).toBe(false)
  })

  it('is what an undo takes back, rather than the command before it', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.selectedLabelId = 'a'
    // A drag writes through and only records on release, so the test does both.
    project.moveLabel(PAGE, 'a', 0.2, 0.2)
    editor.cmdMoveLabel(PAGE, 'a', { x: 0.5, y: 0.5 }, { x: 0.2, y: 0.2 })
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')

    editor.undo()
    expect(labelsOf(project)[0].text).toBe('a0')
    expect(labelsOf(project)[0].x).toBe(0.2)
  })

  it('ends the redo branch, so a redo after typing is a no-op', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.selectedLabelId = 'a'
    editor.deleteSelectedLabel()
    editor.undo()
    expect(editor.canRedo).toBe(true)

    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')
    editor.redo()

    expect(labelsOf(project)).toHaveLength(1)
    expect(editor.canRedo).toBe(false)
  })
})
