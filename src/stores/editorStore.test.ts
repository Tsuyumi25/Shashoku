import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'
import type { ProjectFile } from '@/types/project'
import type { GroupLayerEntry, LayerEntry, TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { linesOf, textOf } from '@shared/page/text'

const PAGE = 'p001.png'

function label(id: string, text = ''): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    x: 0.5,
    y: 0.5,
    groupId: null,
    rotation: 0,
    lines: linesOf(text),
  }
}

function openOnePage(labels: TextLayerEntry[] = []) {
  const project = useProjectStore()
  project.files = [
    {
      filename: PAGE,
      pageDir: `/x/${PAGE}`,
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        readingOrder: labels.map((l) => l.id),
        layers: [...labels],
      },
      badge: 'ok',
    },
  ]
  const editor = useEditorStore()
  editor.currentFilename = PAGE
  return { project, editor }
}

function pageOf(filename: string, labels: TextLayerEntry[]): ProjectFile {
  return {
    filename,
    pageDir: `/x/${filename}`,
    page: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      readingOrder: labels.map((l) => l.id),
      layers: [...labels],
    },
    badge: 'ok',
  }
}

function labelsOf(project: ReturnType<typeof useProjectStore>): TextLayerEntry[] {
  return project.labelsOf(PAGE)
}

const textsOf = (project: ReturnType<typeof useProjectStore>): string[] =>
  labelsOf(project).map(textOf)

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
    expect(added).toMatchObject({ x: 0.25, y: 0.75, groupId: 'grp-1', lines: [''] })
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
    expect(textOf(labelsOf(project)[0])).toBe('before')
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
    expect(textsOf(project)).toEqual(['a1', 'b0'])
    editor.undo()
    expect(textsOf(project)).toEqual(['a0', 'b0'])
  })

  it('keeps the stack in the order things happened', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')
    editor.selectedLabelId = 'a'
    editor.deleteSelectedLabel()

    expect(labelsOf(project)).toHaveLength(0)
    editor.undo()
    expect(textOf(labelsOf(project)[0])).toBe('a1')
    editor.undo()
    expect(textOf(labelsOf(project)[0])).toBe('a0')
  })

  it('flushes what has been typed and keeps the visit open', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')
    editor.flushTextEdit()
    project.updateLabelText(PAGE, 'a', 'a2')
    editor.commitTextEdit()

    editor.undo()
    expect(textOf(labelsOf(project)[0])).toBe('a1')
    editor.undo()
    expect(textOf(labelsOf(project)[0])).toBe('a0')
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
    expect(textOf(labelsOf(project)[0])).toBe('a0')
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

describe('revealLabel', () => {
  it('turns to the page an object lives on and selects that object', () => {
    const project = useProjectStore()
    project.files = [
      pageOf('001.png', [label('a'), label('b')]),
      pageOf('002.png', [label('c'), label('d')]),
    ]
    const editor = useEditorStore()
    editor.currentFilename = '001.png'
    editor.selectedLabelId = 'a'

    editor.revealLabel('002.png', 'd')

    expect(editor.currentFilename).toBe('002.png')
    // Turning the page lands on its first object, so the asked-for one has to
    // be put back afterwards or the jump quietly goes somewhere else.
    expect(editor.selectedLabelId).toBe('d')
  })

  it('selects without turning the page when the object is already here', () => {
    const project = useProjectStore()
    project.files = [pageOf('001.png', [label('a'), label('b')])]
    const editor = useEditorStore()
    editor.currentFilename = '001.png'
    editor.selectedLabelId = 'a'

    editor.revealLabel('001.png', 'b')

    expect(editor.currentFilename).toBe('001.png')
    expect(editor.selectedLabelId).toBe('b')
  })

  it('banks an open editing session when it moves to another page', () => {
    const project = useProjectStore()
    project.files = [pageOf('001.png', [label('a', 'a0')]), pageOf('002.png', [label('c')])]
    const editor = useEditorStore()
    editor.currentFilename = '001.png'
    editor.beginTextEdit('001.png', 'a', 'a0')
    project.updateLabelText('001.png', 'a', 'a1')

    editor.revealLabel('002.png', 'c')

    expect(editor.canUndo).toBe(true)
  })
})

describe('cmdRotateLabel', () => {
  it('takes the object back to how it was lying', () => {
    const { project, editor } = openOnePage([label('a')])
    // A rotate drag writes through and only records on release, as a move does.
    project.rotateLabel(PAGE, 'a', 0.5)
    editor.cmdRotateLabel(PAGE, 'a', 0, 0.5)
    expect(labelsOf(project)[0].rotation).toBe(0.5)

    editor.undo()
    expect(labelsOf(project)[0].rotation).toBe(0)

    editor.redo()
    expect(labelsOf(project)[0].rotation).toBe(0.5)
  })

  it('keeps a turn that ended where it started out of the stack', () => {
    const { editor } = openOnePage([label('a')])
    editor.cmdRotateLabel(PAGE, 'a', 0.25, 0.25)
    expect(editor.canUndo).toBe(false)
  })
})

describe('cmdUpdateLabelStyleOverride', () => {
  it('undoes back to inheriting, rather than to the size it was inheriting', () => {
    const { project, editor } = openOnePage([label('a')])
    project.updateLabelStyleOverride(PAGE, 'a', { fontSizePx: 48 })
    editor.cmdUpdateLabelStyleOverride(PAGE, 'a', undefined, { fontSizePx: 48 })

    editor.undo()
    expect(labelsOf(project)[0].styleOverride).toBeUndefined()
  })

  it('leaves the rest of an existing override alone', () => {
    const { project, editor } = openOnePage([label('a')])
    const before = { color: '#ff0000' }
    project.updateLabelStyleOverride(PAGE, 'a', before)
    project.updateLabelStyleOverride(PAGE, 'a', { color: '#ff0000', fontSizePx: 48 })
    editor.cmdUpdateLabelStyleOverride(PAGE, 'a', before, { color: '#ff0000', fontSizePx: 48 })

    editor.undo()
    expect(labelsOf(project)[0].styleOverride).toEqual({ color: '#ff0000' })
  })

  it('keeps a corner nudged and put back out of the stack', () => {
    const { editor } = openOnePage([label('a')])
    editor.cmdUpdateLabelStyleOverride(PAGE, 'a', { fontSizePx: 24 }, { fontSizePx: 24 })
    expect(editor.canUndo).toBe(false)
  })
})

describe('layer tree edits', () => {
  function folder(id: string, children: TextLayerEntry[]): GroupLayerEntry {
    return { kind: 'group', id, name: id, visible: true, locked: false, children }
  }

  function openTree(layers: LayerEntry[], readingOrder: string[]) {
    const project = useProjectStore()
    project.files = [
      {
        filename: PAGE,
        pageDir: `/x/${PAGE}`,
        page: { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, readingOrder, layers },
        badge: 'ok',
      },
    ]
    const editor = useEditorStore()
    editor.currentFilename = PAGE
    return { project, editor }
  }

  const stackOf = (project: ReturnType<typeof useProjectStore>): string[] =>
    (project.fileByName(PAGE)?.page.layers ?? []).map((e) => e.id)

  const orderOf = (project: ReturnType<typeof useProjectStore>): string[] =>
    project.fileByName(PAGE)?.page.readingOrder ?? []

  /**
   * The reason the two orders are held apart at all: restacking is about what
   * covers what, and has nothing to say about what is read first.
   */
  it('restacks without disturbing what order the page is read in', () => {
    const { project, editor } = openTree([label('a'), label('b'), label('c')], ['a', 'b', 'c'])

    editor.cmdMoveLayer(PAGE, 'a', [0], { parentPath: [], index: 3 })

    expect(stackOf(project)).toEqual(['b', 'c', 'a'])
    expect(orderOf(project)).toEqual(['a', 'b', 'c'])
  })

  it('undoes a restack back to where the entry came from', () => {
    const { project, editor } = openTree([label('a'), label('b'), label('c')], ['a', 'b', 'c'])
    editor.cmdMoveLayer(PAGE, 'c', [2], { parentPath: [], index: 0 })
    expect(stackOf(project)).toEqual(['c', 'a', 'b'])

    editor.undo()

    expect(stackOf(project)).toEqual(['a', 'b', 'c'])
  })

  it('keeps a refused drop out of the history', () => {
    const { editor } = openTree([folder('g', [label('a')])], ['a'])

    editor.cmdMoveLayer(PAGE, 'g', [0], { parentPath: [0], index: 0 })

    expect(editor.canUndo).toBe(false)
  })

  it('adds a folder and takes it away again', () => {
    const { project, editor } = openTree([label('a')], ['a'])

    editor.cmdAddFolder(PAGE, '對白')
    expect(stackOf(project)).toHaveLength(2)

    editor.undo()
    expect(stackOf(project)).toEqual(['a'])
  })

  it('leaves what a folder held behind when it is dissolved, and re-wraps on undo', () => {
    const { project, editor } = openTree(
      [label('a'), folder('g', [label('b'), label('c')])],
      ['a', 'b', 'c'],
    )

    editor.cmdDissolveFolder(PAGE, 'g')
    expect(stackOf(project)).toEqual(['a', 'b', 'c'])
    expect(orderOf(project)).toEqual(['a', 'b', 'c'])

    editor.undo()
    expect(stackOf(project)).toEqual(['a', 'g'])
  })

  it('hides a layer and shows it again', () => {
    const { project, editor } = openTree([label('a')], ['a'])

    editor.cmdSetLayerVisible(PAGE, 'a', false)
    expect(project.labelById(PAGE, 'a')?.visible).toBe(false)

    editor.undo()
    expect(project.labelById(PAGE, 'a')?.visible).toBe(true)
  })
})
