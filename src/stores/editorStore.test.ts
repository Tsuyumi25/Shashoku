import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { isSelectionTool, maskBrushModeOf, UNDO_LIMIT, useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'
import type { ProjectFile } from '@/types/project'
import type { GroupLayerEntry, LayerEntry, TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from '@shared/page/types'
import { linesOf, textOf } from '@shared/page/text'

const PAGE = 'p001.png'

function label(id: string, text = ''): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
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

  it('answers which way each mask tool draws, and nothing for the rest', () => {
    expect(maskBrushModeOf('brush')).toBe('paint')
    expect(maskBrushModeOf('eraser')).toBe('erase')
    expect(maskBrushModeOf('lasso')).toBeNull()
    expect(maskBrushModeOf('select')).toBeNull()
  })

  it('counts both mask tools as building a selection', () => {
    expect(isSelectionTool('brush')).toBe(true)
    expect(isSelectionTool('eraser')).toBe(true)
    expect(isSelectionTool('text')).toBe(false)
  })
})

describe('selection', () => {
  const setOf = (editor: ReturnType<typeof useEditorStore>): string[] =>
    [...editor.selectedIds].sort()

  it('starts empty, with nowhere for the cursor to be', () => {
    const editor = useEditorStore()
    expect(setOf(editor)).toEqual([])
    expect(editor.cursorId).toBeNull()
  })

  it('holds one object as both the cursor and the whole selection', () => {
    const { editor } = openOnePage([label('a'), label('b')])

    editor.selectOnly('b')

    expect(editor.cursorId).toBe('b')
    expect(setOf(editor)).toEqual(['b'])
    expect(editor.isSelected('b')).toBe(true)
    expect(editor.isSelected('a')).toBe(false)
  })

  it('replaces rather than accumulates', () => {
    const { editor } = openOnePage([label('a'), label('b')])
    editor.selectOnly('a')
    editor.selectOnly('b')
    expect(setOf(editor)).toEqual(['b'])
  })

  it('empties both halves together', () => {
    const { editor } = openOnePage([label('a')])
    editor.selectOnly('a')

    editor.selectOnly(null)

    expect(editor.cursorId).toBeNull()
    expect(setOf(editor)).toEqual([])
  })

  // The invariant the whole model rests on: there is one selection, and the
  // cursor is a position inside it rather than a second selection of its own.
  it('keeps the cursor inside the selection through a page turn', () => {
    const project = useProjectStore()
    project.files = [pageOf('001.png', [label('a')]), pageOf('002.png', [label('c')])]
    const editor = useEditorStore()
    editor.selectFile('001.png')
    expect(setOf(editor)).toEqual(['a'])

    editor.pageBy(1)

    expect(editor.cursorId).toBe('c')
    expect(setOf(editor)).toEqual(['c'])
  })

  it('leaves the cursor in the selection after the one it pointed at is deleted', () => {
    const { editor } = openOnePage([label('a'), label('b'), label('c')])
    editor.selectOnly('b')

    editor.deleteSelection()

    expect(editor.cursorId).toBe('c')
    expect(setOf(editor)).toEqual(['c'])
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
    expect(editor.cursorId).toBe(added?.id)
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
    editor.selectOnly('b')

    editor.deleteSelection()

    expect(labelsOf(project).map((l) => l.id)).toEqual(['a', 'c'])
    expect(editor.cursorId).toBe('c')
  })

  it('undoes back into the slot it was deleted from', () => {
    const { project, editor } = openOnePage([label('a'), label('b'), label('c')])
    editor.selectOnly('b')
    editor.deleteSelection()

    editor.undo()

    expect(labelsOf(project).map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('does nothing with no selection', () => {
    const { project, editor } = openOnePage([label('a')])
    editor.selectOnly(null)
    editor.deleteSelection()
    expect(labelsOf(project)).toHaveLength(1)
    expect(editor.canUndo).toBe(false)
  })
})

describe('the undo stack is bounded', () => {
  it('reaches back a fixed number of steps rather than growing for ever', () => {
    const editor = useEditorStore()
    const undone: number[] = []
    for (let i = 0; i < UNDO_LIMIT + 3; i += 1) {
      editor.pushCommand({ label: `step ${i}`, do: () => {}, undo: () => undone.push(i) })
    }

    while (editor.canUndo) editor.undo()

    expect(undone).toHaveLength(UNDO_LIMIT)
    // The three oldest fell off the bottom, so the furthest back still reachable
    // is the fourth thing that happened.
    expect(Math.min(...undone)).toBe(3)
  })

  it('lets redo replay everything the bounded stack still held', () => {
    const editor = useEditorStore()
    const done: number[] = []
    for (let i = 0; i < UNDO_LIMIT + 3; i += 1) {
      editor.pushCommand({ label: `step ${i}`, do: () => done.push(i), undo: () => {} })
    }
    done.length = 0

    while (editor.canUndo) editor.undo()
    while (editor.canRedo) editor.redo()

    expect(done).toHaveLength(UNDO_LIMIT)
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
    editor.selectOnly('a')
    editor.deleteSelection()

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
    editor.selectOnly('a')
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
    editor.selectOnly('a')
    editor.deleteSelection()
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
    editor.selectOnly('a')

    editor.revealLabel('002.png', 'd')

    expect(editor.currentFilename).toBe('002.png')
    // Turning the page lands on its first object, so the asked-for one has to
    // be put back afterwards or the jump quietly goes somewhere else.
    expect(editor.cursorId).toBe('d')
  })

  it('selects without turning the page when the object is already here', () => {
    const project = useProjectStore()
    project.files = [pageOf('001.png', [label('a'), label('b')])]
    const editor = useEditorStore()
    editor.currentFilename = '001.png'
    editor.selectOnly('a')

    editor.revealLabel('001.png', 'b')

    expect(editor.currentFilename).toBe('001.png')
    expect(editor.cursorId).toBe('b')
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
    return {
      kind: 'group',
      id,
      name: id,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: PASS_THROUGH,
      children,
    }
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

describe('deleteSelection', () => {
  function folder(id: string, children: LayerEntry[]): GroupLayerEntry {
    return {
      kind: 'group',
      id,
      name: id,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: PASS_THROUGH,
      children,
    }
  }

  function open(pages: Array<{ name: string; layers: LayerEntry[]; order: string[] }>) {
    const project = useProjectStore()
    project.files = pages.map((p) => ({
      filename: p.name,
      pageDir: `/x/${p.name}`,
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        readingOrder: p.order,
        layers: p.layers,
      },
      badge: 'ok' as const,
    }))
    const editor = useEditorStore()
    editor.currentFilename = pages[0].name
    return { project, editor }
  }

  const orderOf = (project: ReturnType<typeof useProjectStore>, name: string): string[] =>
    project.fileByName(name)?.page.readingOrder ?? []

  const stackOf = (project: ReturnType<typeof useProjectStore>, name: string): string[] =>
    (project.fileByName(name)?.page.layers ?? []).map((e) => e.id)

  it('takes the whole selection in one step of history', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b'), label('c')], order: ['a', 'b', 'c'] },
    ])
    editor.selectOnly('a')
    editor.selectedIds = new Set(['a', 'c'])

    editor.deleteSelection()
    expect(orderOf(project, 'p1')).toEqual(['b'])

    editor.undo()
    expect(orderOf(project, 'p1')).toEqual(['a', 'b', 'c'])
    expect(editor.canUndo).toBe(false)
  })

  // Positions are captured before anything moves, so putting them back cannot
  // depend on the order they happened to come out in.
  it('puts each object back where it was read, not on the end', () => {
    const { project, editor } = open([
      {
        name: 'p1',
        layers: [label('a'), label('b'), label('c'), label('d')],
        order: ['a', 'b', 'c', 'd'],
      },
    ])
    editor.selectOnly('b')
    editor.selectedIds = new Set(['b', 'd'])

    editor.deleteSelection()
    editor.undo()

    expect(orderOf(project, 'p1')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('takes what a folder holds down with it, reading order included', () => {
    const { project, editor } = open([
      {
        name: 'p1',
        layers: [label('a'), folder('g', [label('b'), label('c')])],
        order: ['a', 'b', 'c'],
      },
    ])
    editor.selectOnly('g')

    editor.deleteSelection()

    expect(stackOf(project, 'p1')).toEqual(['a'])
    expect(orderOf(project, 'p1')).toEqual(['a'])
  })

  it('brings a folder back whole, with its contents back in the reading order', () => {
    const { project, editor } = open([
      {
        name: 'p1',
        layers: [label('a'), folder('g', [label('b'), label('c')]), label('d')],
        order: ['a', 'b', 'c', 'd'],
      },
    ])
    editor.selectOnly('g')
    editor.deleteSelection()

    editor.undo()

    expect(stackOf(project, 'p1')).toEqual(['a', 'g', 'd'])
    expect(orderOf(project, 'p1')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('survives a selection holding both a folder and something inside it', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), folder('g', [label('b')])], order: ['a', 'b'] },
    ])
    editor.selectOnly('g')
    editor.selectedIds = new Set(['g', 'b'])

    editor.deleteSelection()
    expect(stackOf(project, 'p1')).toEqual(['a'])

    editor.undo()
    expect(stackOf(project, 'p1')).toEqual(['a', 'g'])
    expect(orderOf(project, 'p1')).toEqual(['a', 'b'])
  })

  /** Deleting never turns the page, whatever it leaves behind. */
  it('stays on the page it was on', () => {
    const { editor } = open([
      { name: 'p1', layers: [label('a')], order: ['a'] },
      { name: 'p2', layers: [label('b')], order: ['b'] },
    ])
    editor.selectOnly('a')

    editor.deleteSelection()

    expect(editor.currentFilename).toBe('p1')
    expect(editor.cursorId).toBeNull()
    expect([...editor.selectedIds]).toEqual([])
  })

  it('lands on what took the cursor place when the page still has objects', () => {
    const { editor } = open([
      { name: 'p1', layers: [label('a'), label('b'), label('c')], order: ['a', 'b', 'c'] },
    ])
    editor.selectOnly('b')

    editor.deleteSelection()

    expect(editor.cursorId).toBe('c')
  })

  it('stays put when the selection reached across pages', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b')], order: ['a', 'b'] },
      { name: 'p2', layers: [label('c')], order: ['c'] },
    ])
    editor.selectOnly('a')
    editor.selectedIds = new Set(['a', 'c'])

    editor.deleteSelection()

    expect(editor.currentFilename).toBe('p1')
    expect(orderOf(project, 'p1')).toEqual(['b'])
    expect(orderOf(project, 'p2')).toEqual([])
    expect(editor.cursorId).toBe('b')
  })
})

describe('building a selection', () => {
  it('adds one and moves the cursor onto it', () => {
    const { editor } = openOnePage([label('a'), label('b')])
    editor.selectOnly('a')

    editor.toggleSelected('b')

    expect([...editor.selectedIds].sort()).toEqual(['a', 'b'])
    expect(editor.cursorId).toBe('b')
  })

  it('takes one back out', () => {
    const { editor } = openOnePage([label('a'), label('b')])
    editor.selectOnly('a')
    editor.toggleSelected('b')

    editor.toggleSelected('b')

    expect([...editor.selectedIds]).toEqual(['a'])
  })

  // The cursor is a place inside the selection, so it cannot be left pointing
  // at something no longer in it.
  it('moves the cursor off an entry that is deselected', () => {
    const { editor } = openOnePage([label('a'), label('b')])
    editor.selectOnly('a')
    editor.toggleSelected('b')
    expect(editor.cursorId).toBe('b')

    editor.toggleSelected('b')

    expect(editor.cursorId).toBe('a')
    expect(editor.selectedIds.has('a')).toBe(true)
  })

  it('leaves no cursor when the last one is taken out', () => {
    const { editor } = openOnePage([label('a')])
    editor.selectOnly('a')

    editor.toggleSelected('a')

    expect(editor.cursorId).toBeNull()
    expect([...editor.selectedIds]).toEqual([])
  })

  it('reaches from the cursor to where it was told, forwards', () => {
    const { editor } = openOnePage([label('a'), label('b'), label('c'), label('d')])
    editor.selectOnly('b')

    editor.extendSelectionTo('d', ['a', 'b', 'c', 'd'])

    expect([...editor.selectedIds].sort()).toEqual(['b', 'c', 'd'])
    expect(editor.cursorId).toBe('d')
  })

  it('reaches backwards just the same', () => {
    const { editor } = openOnePage([label('a'), label('b'), label('c'), label('d')])
    editor.selectOnly('c')

    editor.extendSelectionTo('a', ['a', 'b', 'c', 'd'])

    expect([...editor.selectedIds].sort()).toEqual(['a', 'b', 'c'])
    expect(editor.cursorId).toBe('a')
  })

  it('replaces rather than adds, so a second reach does not accumulate', () => {
    const { editor } = openOnePage([label('a'), label('b'), label('c'), label('d')])
    editor.selectOnly('a')
    editor.extendSelectionTo('d', ['a', 'b', 'c', 'd'])

    editor.selectOnly('a')
    editor.extendSelectionTo('b', ['a', 'b', 'c', 'd'])

    expect([...editor.selectedIds].sort()).toEqual(['a', 'b'])
  })
})

describe('selectLayerBy', () => {
  function folder(id: string, children: LayerEntry[]): GroupLayerEntry {
    return {
      kind: 'group',
      id,
      name: id,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: PASS_THROUGH,
      children,
    }
  }

  function openTree(layers: LayerEntry[], order: string[]) {
    const project = useProjectStore()
    project.files = [
      {
        filename: PAGE,
        pageDir: `/x/${PAGE}`,
        page: { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, readingOrder: order, layers },
        badge: 'ok' as const,
      },
    ]
    const editor = useEditorStore()
    editor.currentFilename = PAGE
    return { editor }
  }

  // The panel reads top to bottom while the array counts bottom to top, so
  // "down" has to mean the row below rather than the next array element.
  it('walks the tree the way the panel shows it', () => {
    const { editor } = openTree([label('under'), label('over')], ['under', 'over'])
    editor.selectOnly('over')

    editor.selectLayerBy(1)

    expect(editor.cursorId).toBe('under')
  })

  it('steps into an open folder', () => {
    const { editor } = openTree([folder('g', [label('a')])], ['a'])
    editor.selectOnly('g')

    editor.selectLayerBy(1)

    expect(editor.cursorId).toBe('a')
  })

  it('steps over a collapsed folder', () => {
    const { editor } = openTree([label('bottom'), folder('g', [label('a')])], ['a', 'bottom'])
    editor.collapsedLayerIds = new Set(['g'])
    editor.selectOnly('g')

    editor.selectLayerBy(1)

    expect(editor.cursorId).toBe('bottom')
  })

  /** The tree is one page's, so there is nowhere to go on past its ends. */
  it('stops at the ends rather than turning the page', () => {
    const { editor } = openTree([label('a')], ['a'])
    editor.selectOnly('a')

    editor.selectLayerBy(1)
    expect(editor.cursorId).toBe('a')

    editor.selectLayerBy(-1)
    expect(editor.cursorId).toBe('a')
  })
})

describe('editBy', () => {
  it('banks the row it leaves and opens the next one', () => {
    const { project, editor } = openOnePage([label('a', 'a0'), label('b', 'b0')])
    editor.selectOnly('a')
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')

    editor.editBy(1)

    expect(editor.canUndo).toBe(true)
    expect(editor.cursorId).toBe('b')
    expect(editor.pendingTextEdit).toEqual({ filename: PAGE, labelId: 'b', from: 'b0' })
  })

  it('carries on to the next page at the end of this one', () => {
    const project = useProjectStore()
    project.files = [pageOf('001.png', [label('a')]), pageOf('002.png', [label('b', 'b0')])]
    const editor = useEditorStore()
    editor.currentFilename = '001.png'
    editor.selectOnly('a')
    editor.beginTextEdit('001.png', 'a', '')

    editor.editBy(1)

    expect(editor.currentFilename).toBe('002.png')
    expect(editor.pendingTextEdit).toEqual({ filename: '002.png', labelId: 'b', from: 'b0' })
  })
})

describe('moveObjectsTo', () => {
  function open(pages: Array<{ name: string; layers: LayerEntry[]; order: string[] }>) {
    const project = useProjectStore()
    project.files = pages.map((p) => ({
      filename: p.name,
      pageDir: `/x/${p.name}`,
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        readingOrder: p.order,
        layers: p.layers,
      },
      badge: 'ok' as const,
    }))
    const editor = useEditorStore()
    editor.currentFilename = pages[0].name
    return { project, editor }
  }

  const orderOf = (project: ReturnType<typeof useProjectStore>, name: string): string[] =>
    project.fileByName(name)?.page.readingOrder ?? []

  const stackOf = (project: ReturnType<typeof useProjectStore>, name: string): string[] =>
    (project.fileByName(name)?.page.layers ?? []).map((e) => e.id)

  /**
   * Reordering within a page is about what is read first, and says nothing
   * about what covers what — so the tree comes through untouched.
   */
  it('reorders a page without restacking it', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b'), label('c')], order: ['a', 'b', 'c'] },
    ])

    editor.moveObjectsTo(['c'], 'p1', 0)

    expect(orderOf(project, 'p1')).toEqual(['c', 'a', 'b'])
    expect(stackOf(project, 'p1')).toEqual(['a', 'b', 'c'])
  })

  it('lands where it was aimed when moving down its own page', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b'), label('c')], order: ['a', 'b', 'c'] },
    ])

    editor.moveObjectsTo(['a'], 'p1', 2)

    expect(orderOf(project, 'p1')).toEqual(['b', 'a', 'c'])
  })

  it('keeps a group of them together, in the order they were read in', () => {
    const { project, editor } = open([
      {
        name: 'p1',
        layers: [label('a'), label('b'), label('c'), label('d')],
        order: ['a', 'b', 'c', 'd'],
      },
    ])

    editor.moveObjectsTo(['a', 'c'], 'p1', 4)

    expect(orderOf(project, 'p1')).toEqual(['b', 'd', 'a', 'c'])
  })

  it('undoes a reorder back to the order it was in', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b'), label('c')], order: ['a', 'b', 'c'] },
    ])
    editor.moveObjectsTo(['c'], 'p1', 0)

    editor.undo()

    expect(orderOf(project, 'p1')).toEqual(['a', 'b', 'c'])
  })

  /** Across pages the object really moves: it leaves one page and joins another. */
  it('carries an object to another page, tree and all', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b')], order: ['a', 'b'] },
      { name: 'p2', layers: [label('c')], order: ['c'] },
    ])

    editor.moveObjectsTo(['a'], 'p2', 1)

    expect(orderOf(project, 'p1')).toEqual(['b'])
    expect(stackOf(project, 'p1')).toEqual(['b'])
    expect(orderOf(project, 'p2')).toEqual(['c', 'a'])
    expect(stackOf(project, 'p2')).toEqual(['c', 'a'])
  })

  it('can land on a page that had nothing on it', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a')], order: ['a'] },
      { name: 'p2', layers: [], order: [] },
    ])

    editor.moveObjectsTo(['a'], 'p2', 0)

    expect(orderOf(project, 'p2')).toEqual(['a'])
    expect(stackOf(project, 'p2')).toEqual(['a'])
    expect(orderOf(project, 'p1')).toEqual([])
  })

  it('sends an object home again on undo, to the place it came from', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b')], order: ['a', 'b'] },
      { name: 'p2', layers: [label('c')], order: ['c'] },
    ])
    editor.moveObjectsTo(['a'], 'p2', 0)

    editor.undo()

    expect(stackOf(project, 'p1')).toEqual(['a', 'b'])
    expect(orderOf(project, 'p1')).toEqual(['a', 'b'])
    expect(stackOf(project, 'p2')).toEqual(['c'])
    expect(orderOf(project, 'p2')).toEqual(['c'])
  })

  it('is one step of history however many pages it touched', () => {
    const { editor } = open([
      { name: 'p1', layers: [label('a'), label('b')], order: ['a', 'b'] },
      { name: 'p2', layers: [label('c')], order: ['c'] },
    ])

    editor.moveObjectsTo(['a', 'c'], 'p2', 0)

    editor.undo()
    expect(editor.canUndo).toBe(false)
  })

  it('does nothing when the drop lands where the objects already are', () => {
    const { editor } = open([
      { name: 'p1', layers: [label('a'), label('b')], order: ['a', 'b'] },
    ])

    editor.moveObjectsTo(['a'], 'p1', 0)

    expect(editor.canUndo).toBe(false)
  })
})

describe('a selection that reaches across pages', () => {
  function open() {
    const project = useProjectStore()
    project.files = [
      pageOf('001.png', [label('a'), label('b')]),
      pageOf('002.png', [label('c'), label('d')]),
    ]
    const editor = useEditorStore()
    editor.currentFilename = '001.png'
    editor.selectOnly('a')
    return { project, editor }
  }

  /**
   * The page shown is wherever the cursor is, and adding an object to the
   * selection moves the cursor onto it — so the click that reaches another
   * page is also the click that turns to it.
   */
  it('turns to the page of an object added from another one', () => {
    const { editor } = open()

    editor.toggleSelected('c')

    expect(editor.cursorId).toBe('c')
    expect(editor.currentFilename).toBe('002.png')
    expect([...editor.selectedIds].sort()).toEqual(['a', 'c'])
  })

  it('turns to the page a range was reached out to', () => {
    const { editor } = open()

    editor.extendSelectionTo('c', ['a', 'b', 'c', 'd'])

    expect(editor.currentFilename).toBe('002.png')
    expect([...editor.selectedIds].sort()).toEqual(['a', 'b', 'c'])
  })

  /**
   * The click decides the page, not the cursor. Taking an object out sends the
   * cursor to some other member, possibly pages away — going there would be
   * going somewhere nobody pointed at.
   */
  it('stays where the click was, even when the click took something away', () => {
    const { editor } = open()
    editor.toggleSelected('c')

    editor.toggleSelected('c')

    expect(editor.cursorId).toBe('a')
    expect(editor.currentFilename).toBe('002.png')
  })

  it('leaves the page alone when the selection empties', () => {
    const { editor } = open()

    editor.toggleSelected('a')

    expect(editor.cursorId).toBeNull()
    expect(editor.currentFilename).toBe('001.png')
  })
})

describe('reaching a range out', () => {
  const SEQ = ['a', 'b', 'c', 'd', 'e']

  function open() {
    const { editor } = openOnePage(SEQ.map((id) => label(id)))
    return editor
  }

  /**
   * A run of Shift clicks all measure from the same place. Measuring from the
   * last one instead chains range onto range, and the selection creeps away
   * from where it started.
   */
  it('keeps measuring from where the range began', () => {
    const editor = open()
    editor.selectOnly('b')

    editor.extendSelectionTo('d', SEQ)
    editor.extendSelectionTo('e', SEQ)

    expect([...editor.selectedIds].sort()).toEqual(['b', 'c', 'd', 'e'])
  })

  it('shrinks when the far end is brought back in', () => {
    const editor = open()
    editor.selectOnly('b')

    editor.extendSelectionTo('e', SEQ)
    editor.extendSelectionTo('c', SEQ)

    expect([...editor.selectedIds].sort()).toEqual(['b', 'c'])
  })

  it('turns around when the far end passes the start', () => {
    const editor = open()
    editor.selectOnly('c')

    editor.extendSelectionTo('e', SEQ)
    editor.extendSelectionTo('a', SEQ)

    expect([...editor.selectedIds].sort()).toEqual(['a', 'b', 'c'])
  })

  it('takes a plain click as the new place to measure from', () => {
    const editor = open()
    editor.selectOnly('a')
    editor.extendSelectionTo('c', SEQ)

    editor.selectOnly('d')
    editor.extendSelectionTo('e', SEQ)

    expect([...editor.selectedIds].sort()).toEqual(['d', 'e'])
  })

  it('takes an added object as the new place to measure from', () => {
    const editor = open()
    editor.selectOnly('a')

    editor.toggleSelected('c')
    editor.extendSelectionTo('e', SEQ)

    expect([...editor.selectedIds].sort()).toEqual(['c', 'd', 'e'])
  })

  it('leaves the cursor on the end that was just reached', () => {
    const editor = open()
    editor.selectOnly('b')

    editor.extendSelectionTo('d', SEQ)

    expect(editor.cursorId).toBe('d')
  })
})

describe('moving through a narrowed list', () => {
  function open() {
    const project = useProjectStore()
    project.files = [
      pageOf('001.png', [label('a', 'そうか'), label('b', 'やめろ'), label('c', 'そうだね')]),
      pageOf('002.png', [label('d', 'まって')]),
    ]
    const editor = useEditorStore()
    editor.currentFilename = '001.png'
    return { editor }
  }

  it('steps over what the search left out', () => {
    const { editor } = open()
    editor.labelQuery = 'そう'
    editor.selectOnly('a')

    editor.selectLabelBy(1)

    expect(editor.cursorId).toBe('c')
  })

  it('stops at the end of what is shown', () => {
    const { editor } = open()
    editor.labelQuery = 'そう'
    editor.selectOnly('c')

    editor.selectLabelBy(1)

    expect(editor.cursorId).toBe('c')
  })

  it('walks the whole chapter again once the search is cleared', () => {
    const { editor } = open()
    editor.selectOnly('a')

    editor.selectLabelBy(1)

    expect(editor.cursorId).toBe('b')
  })

  it('carries on to the next page, narrowed or not', () => {
    const { editor } = open()
    editor.selectOnly('c')

    editor.selectLabelBy(1)

    expect(editor.cursorId).toBe('d')
    expect(editor.currentFilename).toBe('002.png')
  })

  /** An empty page is somewhere the cursor can be, and its heading is the stop. */
  it('comes to rest on a page with nothing on it', () => {
    const project = useProjectStore()
    project.files = [pageOf('001.png', [label('a')]), pageOf('002.png', []), pageOf('003.png', [label('c')])]
    const editor = useEditorStore()
    editor.currentFilename = '001.png'
    editor.selectOnly('a')

    editor.selectLabelBy(1)
    expect(editor.currentFilename).toBe('002.png')
    expect(editor.cursorId).toBeNull()

    editor.selectLabelBy(1)
    expect(editor.cursorId).toBe('c')
  })
})
