import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  isSelectionTool,
  maskBrushModeOf,
  maskJournal,
  MAX_TRACKED_BOOKS,
  rasterJournal,
  UNDO_LIMIT,
  useEditorStore,
} from './editorStore'
import { useProjectStore } from './projectStore'
import { useBookMetaStore } from './bookMetaStore'
import { useNoticeStore } from './noticeStore'
import type { ProjectFile } from '@/types/project'
import type {
  GroupLayerEntry,
  LayerEntry,
  OcrCandidatePersisted,
  RasterLayerEntry,
  SourceTextLayerEntry,
  TextLayerEntry,
  TranslationCandidate,
  TranslationUnit,
} from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from '@shared/page/types'
import { linesOf } from '@shared/page/text'
import { blocksOf, blocksOnSide, projectionOf } from '@shared/page/units'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { findEntry } from '@shared/page/tree'
import { OCR_SCHEMA_VERSION } from '@shared/page/types'
import { blankBlock } from '@shared/page/schema'
import { offeredReadings } from '@shared/ocr/offer'
import { defaultProjectJson, serializeProjectJson } from '@shared/project/schema'
import type { AppearanceTarget } from '@/lib/appearance'

const PAGE = 'p001.png'

/**
 * One block of lettering. Its translation is built alongside it and given the
 * same id, so every id in these fixtures still names one thing whichever level
 * is asking.
 */
function label(id: string, text = ''): TextLayerEntry {
  const entry = blankBlock(id, 'translation', DEFAULT_TEXT_STYLE)
  entry.body.lines = linesOf(text)
  entry.body.x = 200
  entry.body.y = 150
  return entry
}

const SOURCE_OF = (id: string) => `${id}~s`

function sourceFor(id: string): TextLayerEntry {
  const entry = blankBlock(SOURCE_OF(id), 'source', DEFAULT_TEXT_STYLE)
  entry.body.x = 200
  entry.body.y = 150
  return entry
}

function unitFor(id: string): TranslationUnit {
  return {
    id,
    tags: [],
    source: { members: [SOURCE_OF(id)], separators: [] },
    translation: { members: [id], separators: [] },
    candidates: [],
    chosen: null,
  }
}

/** The blocks of both sides for a run of lettering, plus the units over them. */
const spread = (labels: readonly TextLayerEntry[]) => ({
  layers: labels.flatMap((l) => [l, sourceFor(l.id)]),
  translationUnits: labels.map((l) => unitFor(l.id)),
})

/** What the artwork says under one block of lettering. */
const unitOf = (project: ReturnType<typeof useProjectStore>, id: string) =>
  project.placeOf(PAGE, id)!.unit

/** What the artwork says under one block of lettering. */
const sourceOf = (project: ReturnType<typeof useProjectStore>, id: string) => {
  const unit = unitOf(project, id)
  return (project.blockById(PAGE, unit.source.members[0]) as SourceTextLayerEntry).body
}

function openOnePage(labels: TextLayerEntry[] = []) {
  const project = useProjectStore()
  project.allFiles = [
    {
      pageId: PAGE,
      pageDir: `/x/${PAGE}`,
      ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        name: 'p',
        width: 1200,
        height: 1700,
        ...spread(labels),
        readingOrder: labels.map((l) => l.id),
        readingEdges: [],
      },
      badge: 'ok',
    },
  ]
  const editor = useEditorStore()
  editor.currentPageId = PAGE
  return { project, editor }
}

function pageOf(pageId: string, labels: TextLayerEntry[]): ProjectFile {
  return {
    pageId,
    pageDir: `/x/${pageId}`,
    ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
    page: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      ...spread(labels),
      readingOrder: labels.map((l) => l.id),
      readingEdges: [],
    },
    badge: 'ok',
  }
}

function labelsOf(project: ReturnType<typeof useProjectStore>): TextLayerEntry[] {
  return project
    .labelsOf(PAGE)
    .flatMap((unit) => blocksOf(project.pageById(PAGE)!.page.layers, unit, 'translation'))
}

const textsOf = (project: ReturnType<typeof useProjectStore>): string[] =>
  project
    .labelsOf(PAGE)
    .map((unit) => projectionOf(project.pageById(PAGE)!.page.layers, unit, 'translation'))

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

  /**
   * A selection reaches across pages, which is what the batch operations act
   * on. Turning to the next page to check something must not cost the set a
   * sweep just built.
   */
  it('leaves the selection alone through a page turn', () => {
    const project = useProjectStore()
    project.allFiles = [pageOf('001.png', [label('a')]), pageOf('002.png', [label('c')])]
    const editor = useEditorStore()
    editor.startOnPage('001.png')
    expect(setOf(editor)).toEqual(['a'])

    editor.pageBy(1)

    expect(editor.currentPageId).toBe('002.png')
    expect(editor.cursorId).toBe('a')
    expect(setOf(editor)).toEqual(['a'])
  })

  it('picks a page from the bar without disturbing the selection either', () => {
    const project = useProjectStore()
    project.allFiles = [pageOf('001.png', [label('a')]), pageOf('002.png', [label('c')])]
    const editor = useEditorStore()
    editor.startOnPage('001.png')

    editor.showPage('002.png')

    expect(editor.currentPageId).toBe('002.png')
    expect(setOf(editor)).toEqual(['a'])
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
  /**
   * Untagged on purpose — a tag the tool put on is a tag nobody checked, and
   * classifying afterwards is what the batch operations are for.
   */
  it('appends an empty, untagged label seeded from the project, and selects it', () => {
    const { project, editor } = openOnePage([label('a')])

    editor.addLabelAt(100, 225)

    const added = labelsOf(project).at(-1)
    expect(labelsOf(project)).toHaveLength(2)
    expect(unitOf(project, added!.id)).toMatchObject({ tags: [] })
    expect(added?.body).toMatchObject({ x: 100, y: 225, lines: [''] })
    expect(sourceOf(project, added!.id)).toMatchObject({ x: 100, y: 225, lines: [''] })
    expect(added?.body.style).toEqual(project.header.seedStyle)
    expect(editor.cursorId).toBe(added?.id)
  })

  it('does nothing without a page open', () => {
    const { project, editor } = openOnePage()
    editor.currentPageId = null
    editor.addLabelAt(200, 150)
    expect(labelsOf(project)).toHaveLength(0)
  })

  it('undoes back off the page and redoes into the same slot', () => {
    const { project, editor } = openOnePage([label('a'), label('b')])
    editor.addLabelAt(40, 30)
    const id = labelsOf(project).at(-1)?.id

    editor.undo()
    expect(labelsOf(project).map((l) => l.id)).toEqual(['a', 'b'])

    editor.redo()
    expect(labelsOf(project).map((l) => l.id)).toEqual(['a', 'b', id])
  })

  /**
   * ⭐ Which reading an object stands for is settled once for the whole page.
   * An object that grabbed the nearest reading as it was drawn would be
   * answering a question the page is about to answer properly.
   */
  it('leaves a new object standing for nothing, however near a reading is', () => {
    const { project, editor } = openOnePage()
    project.allFiles[0].ocr.candidates = [
      {
        hash: 'near',
        source: 'manga-ocr',
        text: 'ふん',
        original: 'ふん',
        x: 50,
        y: 200,
        w: 100,
        h: 50,
        confidence: 0.99,
        label: 'text_bubble',
      },
    ]
    editor.addLabelAt(100, 225)
    const added = labelsOf(project).at(-1)!
    expect(sourceOf(project, added.id).from).toBeUndefined()
    expect(sourceOf(project, added.id).lines).toEqual([''])
  })
})

describe('cmdApplyVerdict', () => {
  it('does nothing at all when the page decided nothing', () => {
    const { editor } = openOnePage([label('a')])
    editor.cmdApplyVerdict(PAGE, { fills: new Map(), spawns: [] })
    expect(editor.canUndo).toBe(false)
  })

  it('writes the words the page chose onto a standing object, with their source', () => {
    const { project, editor } = openOnePage([label('a')])
    editor.cmdApplyVerdict(PAGE, {
      fills: new Map([[SOURCE_OF('a'), { text: 'ふん', from: 'r1' }]]),
      spawns: [],
    })
    expect(sourceOf(project, labelsOf(project)[0]!.id)).toMatchObject({
      lines: ['ふん'],
      from: 'r1',
      by: 'auto',
    })
  })

  it('creates an object set the way the artwork was measured', () => {
    const { project, editor } = openOnePage()
    editor.cmdApplyVerdict(PAGE, {
      fills: new Map(),
      spawns: [
        {
          from: 'r1',
          text: 'ふん',
          centre: { x: 300, y: 400 },
          vertical: true,
          fontSizePx: 38,
          leadingPercent: 118,
        },
      ],
    })
    const born = labelsOf(project).at(-1)
    expect(born?.body.style).toMatchObject({
      direction: 'vertical',
      fontSizePx: 38,
      leadingPercent: 118,
    })
    expect(sourceOf(project, born!.id)).toMatchObject({ lines: ['ふん'], from: 'r1', by: 'auto' })
  })

  it('leaves the seed style alone where the run measured nothing', () => {
    const { project, editor } = openOnePage()
    editor.cmdApplyVerdict(PAGE, {
      fills: new Map(),
      spawns: [{ from: 'r1', text: 'ふん', centre: { x: 300, y: 400 } }],
    })
    expect(labelsOf(project).at(-1)?.body.style).toEqual(project.header.seedStyle)
  })

  /**
   * ⭐ What somebody wants back after pressing the button is the page as it was
   * before they pressed it, not one object of eleven.
   */
  it('takes a whole run back in one step', () => {
    const { project, editor } = openOnePage([label('a')])
    editor.cmdApplyVerdict(PAGE, {
      fills: new Map([[SOURCE_OF('a'), { text: 'いち', from: 'r1' }]]),
      spawns: [
        { from: 'r2', text: 'に', centre: { x: 300, y: 400 } },
        { from: 'r3', text: 'さん', centre: { x: 600, y: 400 } },
      ],
    })
    expect(labelsOf(project)).toHaveLength(3)

    editor.undo()
    expect(labelsOf(project)).toHaveLength(1)
    expect(sourceOf(project, labelsOf(project)[0].id).from).toBeUndefined()
    expect(sourceOf(project, labelsOf(project)[0].id).lines).toEqual([''])

    editor.redo()
    expect(labelsOf(project)).toHaveLength(3)
    expect(sourceOf(project, labelsOf(project)[0]!.id)).toMatchObject({ lines: ['いち'], from: 'r1' })
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
    expect(added?.body.x).toBeCloseTo(200, 6)
    expect(added?.body.y).toBeCloseTo(150, 6)
  })

  it('clamps onto the page when the view has been panned off it', () => {
    const { project, editor } = openOnePage()
    editor.viewContainerSize = { w: 800, h: 600 }
    editor.viewContentSize = { w: 400, h: 300 }
    editor.fitToView()
    editor.panBy(-5000, -5000)

    editor.addLabelAtViewCenter()

    expect(labelsOf(project).at(-1)?.body).toMatchObject({ x: 400, y: 300 })
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
      editor.pushCommand({ label: `step ${i}`, do: () => {}, undo: () => { undone.push(i) } })
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
      editor.pushCommand({
        label: `step ${i}`,
        do: () => {
          done.push(i)
        },
        undo: () => {},
      })
    }
    done.length = 0

    while (editor.canUndo) editor.undo()
    while (editor.canRedo) editor.redo()

    expect(done).toHaveLength(UNDO_LIMIT)
  })
})

describe('steps whose pixels the engine let go', () => {
  /** A step with an engine record behind it, noting when it is let go. */
  function pixelStep(editor: ReturnType<typeof useEditorStore>, journal: string, forgotten: string[]) {
    editor.pushCommand({
      label: `fill ${journal}`,
      journals: [rasterJournal(journal)],
      do: () => {},
      undo: () => {},
      forget: () => forgotten.push(journal),
    })
  }

  /**
   * History is linear: a step that cannot be replayed is one nothing under it
   * can be reached past, so the cut takes everything below the newest casualty
   * rather than plucking the named ones out of the middle.
   */
  it('cuts the stack at the newest step it lost', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    for (const name of ['j1', 'j2', 'j3', 'j4']) pixelStep(editor, name, forgotten)

    editor.forgetJournals(['j1', 'j2'])

    expect(forgotten).toEqual(['j1', 'j2'])
    const undone: string[] = []
    editor.pushCommand({ label: 'mark', do: () => {}, undo: () => { undone.push('mark') } })
    while (editor.canUndo) editor.undo()
    expect(forgotten).toEqual(['j1', 'j2'])
    expect(undone).toEqual(['mark'])
  })

  // Document steps under a lost pixel step go too — one Ctrl+Z means one thing,
  // and a stack that skipped a hole would replay the page out of order.
  it('takes the plain steps under it as well', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    const undone: string[] = []
    editor.pushCommand({ label: 'rename', do: () => {}, undo: () => { undone.push('rename') } })
    pixelStep(editor, 'j1', forgotten)
    editor.pushCommand({ label: 'move', do: () => {}, undo: () => { undone.push('move') } })

    editor.forgetJournals(['j1'])
    while (editor.canUndo) editor.undo()

    expect(undone).toEqual(['move'])
  })

  it('says nothing and does nothing when it lost none of them', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    pixelStep(editor, 'j1', forgotten)

    editor.forgetJournals(['j9'])

    expect(forgotten).toEqual([])
    expect(editor.canUndo).toBe(true)
  })

  // A branch that outlived its own pixels cannot be replayed either.
  it('drops a redo branch that lost a step', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    pixelStep(editor, 'j1', forgotten)
    editor.undo()
    expect(editor.canRedo).toBe(true)

    editor.forgetJournals(['j1'])

    expect(editor.canRedo).toBe(false)
    expect(forgotten).toEqual(['j1'])
  })

  it('lets a step go when it falls off the bottom of the bounded stack', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    pixelStep(editor, 'j1', forgotten)
    for (let i = 0; i < UNDO_LIMIT; i += 1) {
      editor.pushCommand({ label: `step ${i}`, do: () => {}, undo: () => {} })
    }

    expect(forgotten).toEqual(['j1'])
  })

  it('lets everything go when the history is cleared', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    pixelStep(editor, 'j1', forgotten)
    pixelStep(editor, 'j2', forgotten)

    editor.clearHistory()

    expect(forgotten).toEqual(['j1', 'j2'])
  })
})

describe('steps that depend on more than one registry', () => {
  /** A step whose undo depends on a journal outside the raster registry. */
  function maskStep(editor: ReturnType<typeof useEditorStore>, name: string, forgotten: string[]) {
    editor.pushCommand({
      label: `select ${name}`,
      journals: [{ kind: 'mask', name }],
      do: () => {},
      undo: () => {},
      forget: () => forgotten.push(name),
    })
  }

  it('cuts the stack on a `journals` entry the same way it does the legacy `journal` field', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    maskStep(editor, 'm1', forgotten)
    editor.pushCommand({ label: 'plain', do: () => {}, undo: () => {} })

    editor.forgetJournals(['m1'], 'mask')

    expect(forgotten).toEqual(['m1'])
    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(editor.canUndo).toBe(false)
  })

  it('takes plain steps under a lost mask journal, same as it does for a raster one', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    const undone: string[] = []
    editor.pushCommand({ label: 'rename', do: () => {}, undo: () => { undone.push('rename') } })
    maskStep(editor, 'm1', forgotten)
    editor.pushCommand({ label: 'move', do: () => {}, undo: () => { undone.push('move') } })

    editor.forgetJournals(['m1'], 'mask')
    while (editor.canUndo) editor.undo()

    expect(undone).toEqual(['move'])
  })

  /**
   * The two registries are tagged rather than sharing a namespace, so a name
   * that happens to match across them is not a collision — a raster cut must
   * never reach a mask-only step, or the other way round.
   */
  it('does not let a mask cut touch a step that only names a raster journal of the same name', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    editor.pushCommand({
      label: 'fill j1',
      journals: [rasterJournal('j1')],
      do: () => {},
      undo: () => {},
      forget: () => forgotten.push('j1'),
    })

    editor.forgetJournals(['j1'], 'mask')

    expect(forgotten).toEqual([])
    expect(editor.canUndo).toBe(true)
  })

  it('does not let a raster cut touch a step that only names a mask journal of the same name', () => {
    const editor = useEditorStore()
    const forgotten: string[] = []
    maskStep(editor, 'j1', forgotten)

    editor.forgetJournals(['j1'])

    expect(forgotten).toEqual([])
    expect(editor.canUndo).toBe(true)
  })
})

describe('one stack per book', () => {
  it('keeps two books’ histories separate while work on them interleaves', () => {
    const project = useProjectStore()
    const editor = useEditorStore()

    project.rootPath = '/book-a'
    const doneA: string[] = []
    editor.pushCommand({ label: 'a1', do: () => {}, undo: () => { doneA.push('undo-a1') } })

    project.rootPath = '/book-b'
    const doneB: string[] = []
    editor.pushCommand({ label: 'b1', do: () => {}, undo: () => { doneB.push('undo-b1') } })
    editor.pushCommand({ label: 'b2', do: () => {}, undo: () => { doneB.push('undo-b2') } })

    // Undoing on B must never reach A's command.
    editor.undo()
    expect(doneB).toEqual(['undo-b2'])
    expect(doneA).toEqual([])

    // Coming back to A finds its one step untouched by anything done on B.
    project.rootPath = '/book-a'
    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(doneA).toEqual(['undo-a1'])
    expect(editor.canUndo).toBe(false)

    // B still has its remaining step, exactly where it was left.
    project.rootPath = '/book-b'
    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(doneB).toEqual(['undo-b2', 'undo-b1'])
  })

  it('lets forgetJournals cut a book that is not the one open right now', () => {
    const project = useProjectStore()
    const editor = useEditorStore()

    project.rootPath = '/book-a'
    const forgotten: string[] = []
    editor.pushCommand({
      label: 'masked',
      journals: [maskJournal('m1')],
      do: () => {},
      undo: () => {},
      forget: () => forgotten.push('m1'),
    })

    // A project switch reads the outgoing book before projectStore moves on.
    project.rootPath = '/book-b'
    editor.forgetJournals(['m1'], 'mask', '/book-a')

    expect(forgotten).toEqual(['m1'])
    project.rootPath = '/book-a'
    expect(editor.canUndo).toBe(false)
  })
})

describe('closing a book', () => {
  it('cuts a stack at its newest session-bound command, keeping only the portable run above it', () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.rootPath = '/book-a'

    const undone: string[] = []
    editor.pushCommand({ label: 'session-1', do: () => {}, undo: () => { undone.push('session-1') } })
    editor.pushCommand({
      label: 'portable-1',
      portable: true,
      do: () => {},
      undo: () => { undone.push('portable-1') },
    })
    editor.pushCommand({
      label: 'portable-2',
      portable: true,
      do: () => {},
      undo: () => { undone.push('portable-2') },
    })

    editor.closeBook('/book-a')

    expect(editor.canUndo).toBe(true)
    editor.undo()
    editor.undo()
    expect(undone).toEqual(['portable-2', 'portable-1'])
    expect(editor.canUndo).toBe(false)
  })

  it('wipes a stack outright when every command on it is session-bound', () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.rootPath = '/book-a'

    editor.pushCommand({ label: 'session-1', do: () => {}, undo: () => {} })
    editor.pushCommand({ label: 'session-2', do: () => {}, undo: () => {} })

    editor.closeBook('/book-a')

    expect(editor.canUndo).toBe(false)
  })

  it('leaves a stack whole when nothing on it was ever session-bound', () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.rootPath = '/shelf-only'

    const undone: string[] = []
    editor.pushCommand({
      label: 'p1',
      portable: true,
      do: () => {},
      undo: () => { undone.push('p1') },
    })
    editor.pushCommand({
      label: 'p2',
      portable: true,
      do: () => {},
      undo: () => { undone.push('p2') },
    })

    // Closed, as it would be on switching away, then switched back to.
    editor.closeBook('/shelf-only')
    project.rootPath = '/elsewhere'
    project.rootPath = '/shelf-only'

    editor.undo()
    editor.undo()
    expect(undone).toEqual(['p2', 'p1'])
    expect(editor.canUndo).toBe(false)
  })

  it('does nothing to a book that never had a stack', () => {
    const editor = useEditorStore()
    expect(() => editor.closeBook('/never-touched')).not.toThrow()
  })
})

describe('how many books keep a stack at once', () => {
  it('drops the least recently touched book once the count passes the bound', () => {
    const project = useProjectStore()
    const editor = useEditorStore()

    // One portable step per book, so closing leaves something behind to check.
    for (let i = 0; i <= MAX_TRACKED_BOOKS; i += 1) {
      project.rootPath = `/book-${i}`
      editor.pushCommand({ label: 'p', portable: true, do: () => {}, undo: () => {} })
      editor.closeBook(`/book-${i}`)
    }

    // The very first book touched is now the least recently touched one.
    project.rootPath = '/book-0'
    expect(editor.canUndo).toBe(false)

    // Every book touched since is still there.
    project.rootPath = `/book-${MAX_TRACKED_BOOKS}`
    expect(editor.canUndo).toBe(true)
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
    expect(labelsOf(project)[0].body.lines.join('\n')).toBe('before')
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
    expect(textsOf(project)[0]).toBe('a1')
    editor.undo()
    expect(textsOf(project)[0]).toBe('a0')
  })

  it('flushes what has been typed and keeps the visit open', () => {
    const { project, editor } = openOnePage([label('a', 'a0')])
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')
    editor.flushTextEdit()
    project.updateLabelText(PAGE, 'a', 'a2')
    editor.commitTextEdit()

    editor.undo()
    expect(textsOf(project)[0]).toBe('a1')
    editor.undo()
    expect(textsOf(project)[0]).toBe('a0')
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
    project.moveLabel(PAGE, 'a', 80, 60)
    editor.cmdMoveLabel(PAGE, 'a', { x: 200, y: 150 }, { x: 80, y: 60 })
    editor.beginTextEdit(PAGE, 'a', 'a0')
    project.updateLabelText(PAGE, 'a', 'a1')

    editor.undo()
    expect(textsOf(project)[0]).toBe('a0')
    expect(labelsOf(project)[0].body.x).toBe(80)
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

describe('pending reading edit', () => {
  const withReading = (text: string, labels: ReturnType<typeof label>[] = []) => {
    const opened = openOnePage(labels)
    opened.project.allFiles[0].ocr.candidates = [
      {
        hash: 'r1',
        source: 'manga-ocr',
        text,
        original: text,
        x: 50,
        y: 200,
        w: 100,
        h: 50,
        confidence: 0.99,
        label: 'text_bubble',
      },
    ]
    return opened
  }

  it('turns one correction into one undo entry', () => {
    const { project, editor } = withReading('ふん')
    editor.beginReadingEdit(PAGE, 'r1', 'ふん')
    project.setReadingText(PAGE, 'r1', 'ふ')
    project.setReadingText(PAGE, 'r1', 'ふう')
    project.setReadingText(PAGE, 'r1', 'ふうん')
    editor.commitTextEdit()

    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(project.readingsOfPage(PAGE)[0].text).toBe('ふん')
    expect(editor.canUndo).toBe(false)
  })

  it('records nothing when the text came back unchanged', () => {
    const { project, editor } = withReading('ふん')
    editor.beginReadingEdit(PAGE, 'r1', 'ふん')
    project.setReadingText(PAGE, 'r1', 'ふうん')
    project.setReadingText(PAGE, 'r1', 'ふん')
    editor.commitTextEdit()
    expect(editor.canUndo).toBe(false)
  })

  /**
   * ⭐ The whole reason this shares the object side's choke point rather than
   * having one of its own: everything that already ends a typing session ends
   * this kind too, without any of those places knowing it exists.
   */
  it('is closed by a typing session on an object beginning', () => {
    const { project, editor } = withReading('ふん', [label('a', 'a0')])
    editor.beginReadingEdit(PAGE, 'r1', 'ふん')
    project.setReadingText(PAGE, 'r1', 'ふうん')
    editor.beginTextEdit(PAGE, 'a', 'a0')

    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(project.readingsOfPage(PAGE)[0].text).toBe('ふん')
  })

  it('keeps the stack in the order things happened', () => {
    const { project, editor } = withReading('ふん', [label('a', 'a0')])
    editor.beginReadingEdit(PAGE, 'r1', 'ふん')
    project.setReadingText(PAGE, 'r1', 'ふうん')
    editor.selectOnly('a')
    editor.deleteSelection()

    expect(labelsOf(project)).toHaveLength(0)
    editor.undo()
    expect(labelsOf(project)).toHaveLength(1)
    expect(project.readingsOfPage(PAGE)[0].text).toBe('ふうん')
    editor.undo()
    expect(project.readingsOfPage(PAGE)[0].text).toBe('ふん')
  })

  /**
   * ⭐ What makes correcting a reading safe to offer at all. The identity is
   * fixed when the reading is created, so an object built from it goes on
   * naming it and a rerun still recognizes it as one the page already has.
   */
  it('leaves the identity and what the model said where they were', () => {
    const { project, editor } = withReading('ふん')
    editor.beginReadingEdit(PAGE, 'r1', 'ふん')
    project.setReadingText(PAGE, 'r1', 'ふうん')
    editor.commitTextEdit()

    expect(project.readingsOfPage(PAGE)[0].hash).toBe('r1')
    expect(project.readingsOfPage(PAGE)[0].original).toBe('ふん')
  })

  it('drops a session whose reading has left the pool', () => {
    const { project, editor } = withReading('ふん')
    editor.beginReadingEdit(PAGE, 'r1', 'ふん')
    project.forgetReadings(PAGE)
    editor.commitTextEdit()
    expect(editor.canUndo).toBe(false)
  })

  it('flushes what has been typed and keeps the visit open', () => {
    const { project, editor } = withReading('ふん')
    editor.beginReadingEdit(PAGE, 'r1', 'ふん')
    project.setReadingText(PAGE, 'r1', 'ふう')
    editor.flushTextEdit()
    project.setReadingText(PAGE, 'r1', 'ふうん')
    editor.commitTextEdit()

    editor.undo()
    expect(project.readingsOfPage(PAGE)[0].text).toBe('ふう')
    editor.undo()
    expect(project.readingsOfPage(PAGE)[0].text).toBe('ふん')
  })
})

describe('revealLabel', () => {
  it('turns to the page an object lives on and selects that object', () => {
    const project = useProjectStore()
    project.allFiles = [
      pageOf('001.png', [label('a'), label('b')]),
      pageOf('002.png', [label('c'), label('d')]),
    ]
    const editor = useEditorStore()
    editor.currentPageId = '001.png'
    editor.selectOnly('a')

    editor.revealLabel('002.png', 'd')

    expect(editor.currentPageId).toBe('002.png')
    // Turning the page lands on its first object, so the asked-for one has to
    // be put back afterwards or the jump quietly goes somewhere else.
    expect(editor.cursorId).toBe('d')
  })

  it('selects without turning the page when the object is already here', () => {
    const project = useProjectStore()
    project.allFiles = [pageOf('001.png', [label('a'), label('b')])]
    const editor = useEditorStore()
    editor.currentPageId = '001.png'
    editor.selectOnly('a')

    editor.revealLabel('001.png', 'b')

    expect(editor.currentPageId).toBe('001.png')
    expect(editor.cursorId).toBe('b')
  })

  it('banks an open editing session when it moves to another page', () => {
    const project = useProjectStore()
    project.allFiles = [pageOf('001.png', [label('a', 'a0')]), pageOf('002.png', [label('c')])]
    const editor = useEditorStore()
    editor.currentPageId = '001.png'
    editor.beginTextEdit('001.png', 'a', 'a0')
    project.updateLabelText('001.png', 'a', 'a1')

    editor.revealLabel('002.png', 'c')

    expect(editor.canUndo).toBe(true)
  })
})

describe('cmdRotateLabel', () => {
  /** Where `label('a')` stands, so a turn can be said to have moved it. */
  const PUT = { x: 200, y: 150 }

  it('takes the object back to how it was lying', () => {
    const { project, editor } = openOnePage([label('a')])
    // A rotate drag writes through and only records on release, as a move does.
    project.rotateLabel(PAGE, 'a', 0.5)
    editor.cmdRotateLabel(PAGE, 'a', { rotation: 0, ...PUT }, { rotation: 0.5, ...PUT })
    expect(labelsOf(project)[0].body.rotation).toBe(0.5)

    editor.undo()
    expect(labelsOf(project)[0].body.rotation).toBe(0)

    editor.redo()
    expect(labelsOf(project)[0].body.rotation).toBe(0.5)
  })

  /**
   * A turn around anything but the object's own middle swings it across the
   * page, so the position is part of what a turn is and goes back with it.
   */
  it('puts the position back with the angle', () => {
    const { project, editor } = openOnePage([label('a')])
    project.rotateLabel(PAGE, 'a', 0.5)
    project.moveLabel(PAGE, 'a', 260, 190)
    editor.cmdRotateLabel(PAGE, 'a', { rotation: 0, ...PUT }, { rotation: 0.5, x: 260, y: 190 })

    editor.undo()
    const back = labelsOf(project)[0]
    expect([back.body.x, back.body.y]).toEqual([PUT.x, PUT.y])
  })

  it('keeps a turn that ended where it started out of the stack', () => {
    const { editor } = openOnePage([label('a')])
    const lying = { rotation: 0.25, ...PUT }
    editor.cmdRotateLabel(PAGE, 'a', lying, { ...lying })
    expect(editor.canUndo).toBe(false)
  })
})

describe('cmdScaleLabel', () => {
  /** Where `label('a')` stands, so a gesture can be said to have moved it. */
  const PUT = { x: 200, y: 150 }

  const sized = (fontSizePx: number): TextStyle => ({ ...DEFAULT_TEXT_STYLE, fontSizePx })

  it('undoes back to the size the object had before the drag', () => {
    const { project, editor } = openOnePage([label('a')])
    project.setLabelStyle(PAGE, 'a', sized(48))
    editor.cmdScaleLabel(
      PAGE,
      'a',
      { style: sized(24), ...PUT },
      { style: sized(48), ...PUT },
    )

    editor.undo()
    expect(labelsOf(project)[0].body.style.fontSizePx).toBe(24)
  })

  it('leaves the fields the drag did not touch alone', () => {
    const { project, editor } = openOnePage([label('a')])
    const before: TextStyle = { ...DEFAULT_TEXT_STYLE, color: '#ff0000' }
    project.setLabelStyle(PAGE, 'a', { ...before, fontSizePx: 48 })
    editor.cmdScaleLabel(
      PAGE,
      'a',
      { style: before, ...PUT },
      { style: { ...before, fontSizePx: 48 }, ...PUT },
    )

    editor.undo()
    expect(labelsOf(project)[0].body.style).toEqual(before)
  })

  /**
   * A corner drag moves the object as well as resizing it, since the pinned
   * corner has to stay where it is. Both go back together or the label lands
   * somewhere nobody dragged it.
   */
  it('puts the position back with the size', () => {
    const { project, editor } = openOnePage([label('a')])
    project.setLabelStyle(PAGE, 'a', sized(48))
    project.moveLabel(PAGE, 'a', 260, 190)
    editor.cmdScaleLabel(
      PAGE,
      'a',
      { style: sized(24), ...PUT },
      { style: sized(48), x: 260, y: 190 },
    )

    editor.undo()
    const back = labelsOf(project)[0]
    expect([back.body.x, back.body.y]).toEqual([PUT.x, PUT.y])
    expect(editor.canUndo).toBe(false)
  })

  it('keeps a corner nudged and put back out of the stack', () => {
    const { editor } = openOnePage([label('a')])
    const held = { style: sized(24), ...PUT }
    editor.cmdScaleLabel(PAGE, 'a', held, { ...held })
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
      effects: [],
      children,
    }
  }

  function raster(id: string): RasterLayerEntry {
    return {
      kind: 'raster',
      id,
      name: id,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      effects: [],
      file: `${id}.png`,
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      alphaLocked: false,
    }
  }

  function openTree(layers: LayerEntry[], readingOrder: string[]) {
    const project = useProjectStore()
    project.allFiles = [
      {
        pageId: PAGE,
        pageDir: `/x/${PAGE}`,
        ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
        page: {
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          revision: 0,
          name: 'p',
          width: 1200,
          height: 1700,
          translationUnits: readingOrder.map(unitFor),
          readingOrder,
          readingEdges: [],
          layers: [...layers, ...readingOrder.map(sourceFor)],
        },
        badge: 'ok',
      },
    ]
    const editor = useEditorStore()
    editor.currentPageId = PAGE
    return { project, editor }
  }

  /** ⚠️ The lettering only: the artwork's own blocks sit alongside it and are
   * not what a restack is about. */
  const stackOf = (project: ReturnType<typeof useProjectStore>): string[] =>
    (project.pageById(PAGE)?.page.layers ?? [])
      .filter((e) => !(e.kind === 'text' && e.side === 'source'))
      .map((e) => e.id)

  const orderOf = (project: ReturnType<typeof useProjectStore>): string[] =>
    project.pageById(PAGE)?.page.readingOrder ?? []

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
    expect(project.blockById(PAGE, 'a')?.visible).toBe(false)

    editor.undo()
    expect(project.blockById(PAGE, 'a')?.visible).toBe(true)
  })

  const alphaLockOf = (project: ReturnType<typeof useProjectStore>, id: string): boolean => {
    const entry = findEntry(project.pageById(PAGE)?.page.layers ?? [], id)
    return entry?.kind === 'raster' && entry.alphaLocked
  }

  it("speaks for a raster's transparent pixels, and takes it back", () => {
    const { project, editor } = openTree([raster('r')], [])

    editor.cmdSetLayerAlphaLocked(PAGE, 'r', true)
    expect(alphaLockOf(project, 'r')).toBe(true)

    editor.undo()
    expect(alphaLockOf(project, 'r')).toBe(false)
  })

  it('has nothing to lock on an entry that holds no pixels of its own', () => {
    const { editor } = openTree([folder('g', [label('a')])], ['a'])

    editor.cmdSetLayerAlphaLocked(PAGE, 'g', true)

    expect(editor.canUndo).toBe(false)
  })

  describe('a lock refuses every change', () => {
    const lock = (project: ReturnType<typeof useProjectStore>, id: string) =>
      project.setLayerLocked(PAGE, id, true)

    it('refuses to move, turn or restyle a locked object', () => {
      const { project, editor } = openTree([label('a')], ['a'])
      lock(project, 'a')

      editor.cmdMoveLabel(PAGE, 'a', { x: 200, y: 150 }, { x: 40, y: 30 })
      editor.cmdRotateLabel(
        PAGE,
        'a',
        { rotation: 0, x: 200, y: 150 },
        { rotation: 1, x: 200, y: 150 },
      )
      editor.cmdScaleLabel(
        PAGE,
        'a',
        { style: { ...DEFAULT_TEXT_STYLE }, x: 200, y: 150 },
        { style: { ...DEFAULT_TEXT_STYLE, fontSizePx: 40 }, x: 200, y: 150 },
      )

      expect(editor.canUndo).toBe(false)
    })

    /** A lock that still lets the words be retyped is not protecting anything. */
    it('refuses to retype a locked translation', () => {
      const { project, editor } = openTree([label('a', 'before')], ['a'])
      lock(project, 'a')

      editor.cmdUpdateLabelText(PAGE, 'a', 'before', 'after')

      expect(labelsOf(project)[0].body.lines.join('\n')).toBe('before')
      expect(editor.canUndo).toBe(false)
    })

    it('refuses to rename or reblend a locked layer', () => {
      const { project, editor } = openTree([folder('g', [])], [])
      lock(project, 'g')

      editor.cmdRenameLayer(PAGE, 'g', 'g', '塗白')
      editor.cmdSetBlendMode([{ pageId: PAGE, id: 'g', blendMode: PASS_THROUGH }], 'multiply')

      expect(editor.canUndo).toBe(false)
    })

    it('refuses to restack a locked layer', () => {
      const { project, editor } = openTree([label('a'), label('b')], ['a', 'b'])
      lock(project, 'a')

      editor.cmdMoveLayer(PAGE, 'a', [0], { parentPath: [], index: 2 })

      expect(stackOf(project)).toEqual(['a', 'b'])
    })

    // What a folder holds is part of the folder.
    it('refuses a drop into a locked folder', () => {
      const { project, editor } = openTree([label('a'), folder('g', [])], ['a'])
      lock(project, 'g')

      editor.cmdMoveLayer(PAGE, 'a', [0], { parentPath: [1], index: 0 })

      expect(stackOf(project)).toEqual(['a', 'g'])
    })

    it('refuses to dissolve a locked folder', () => {
      const { project, editor } = openTree([folder('g', [label('a')])], ['a'])
      lock(project, 'g')

      editor.cmdDissolveFolder(PAGE, 'g')

      expect(stackOf(project)).toEqual(['g'])
    })

    /**
     * It passes down, because what gets dragged and deleted by accident is the
     * children — locking only the shell locks a room with no door.
     */
    it('refuses a change to what a locked folder holds', () => {
      const { project, editor } = openTree([folder('g', [label('a', 'before')])], ['a'])
      lock(project, 'g')

      editor.cmdUpdateLabelText(PAGE, 'a', 'before', 'after')

      expect(labelsOf(project)[0].body.lines.join('\n')).toBe('before')
    })

    it('deletes what it can and steps over the locked', () => {
      const { project, editor } = openTree([label('a'), label('b'), label('c')], ['a', 'b', 'c'])
      lock(project, 'b')
      editor.selectOnly('a')
      editor.toggleSelected('b')
      editor.toggleSelected('c')

      editor.deleteSelection()

      expect(stackOf(project)).toEqual(['b'])
    })

    // The eye is a control for looking, not for changing.
    it('still lets a locked layer be hidden and shown', () => {
      const { project, editor } = openTree([label('a')], ['a'])
      lock(project, 'a')

      editor.cmdSetLayerVisible(PAGE, 'a', false)

      expect(project.blockById(PAGE, 'a')?.visible).toBe(false)
    })

    // Where paint may land is exactly what the lock was put on to hold still.
    it('refuses to speak for the transparent pixels of a locked raster', () => {
      const { project, editor } = openTree([raster('r')], [])
      lock(project, 'r')

      editor.cmdSetLayerAlphaLocked(PAGE, 'r', true)

      expect(alphaLockOf(project, 'r')).toBe(false)
    })

    // Refusing this would leave no way to take the lock off again.
    it('still lets the lock itself be taken off', () => {
      const { project, editor } = openTree([label('a')], ['a'])
      lock(project, 'a')

      editor.cmdSetLayerLocked(PAGE, 'a', false)

      expect(editor.isLayerLocked('a')).toBe(false)
    })

    /**
     * Undo reaches `projectStore` straight, and locking is itself a command —
     * so by the time a change is taken back, the lock put on after it has
     * already come off.
     */
    it('undoes a change that was made before the lock went on', () => {
      const { project, editor } = openTree([label('a', 'before')], ['a'])
      editor.cmdUpdateLabelText(PAGE, 'a', 'before', 'after')
      editor.cmdSetLayerLocked(PAGE, 'a', true)

      editor.undo()
      editor.undo()

      expect(labelsOf(project)[0].body.lines.join('\n')).toBe('before')
    })
  })

  describe('renaming', () => {
    const nameOf = (project: ReturnType<typeof useProjectStore>, id: string) => {
      const entry = findEntry(project.pageById(PAGE)?.page.layers ?? [], id)
      return entry !== undefined && entry.kind !== 'text' ? entry.name : undefined
    }

    it('renames a folder and puts the old name back', () => {
      const { project, editor } = openTree([folder('g', [])], [])

      editor.cmdRenameLayer(PAGE, 'g', 'g', '塗白')
      expect(nameOf(project, 'g')).toBe('塗白')

      editor.undo()
      expect(nameOf(project, 'g')).toBe('g')
    })

    /**
     * A text object's translation is its identity. A name of its own would be a
     * second one, free to drift from what the label list shows.
     */
    it('leaves a text object alone, since it has no name of its own', () => {
      const { editor } = openTree([label('a')], ['a'])
      editor.cmdRenameLayer(PAGE, 'a', '', '甲')
      expect(editor.canUndo).toBe(false)
    })

    it('keeps a name typed back to what it was out of the stack', () => {
      const { editor } = openTree([folder('g', [])], [])
      editor.cmdRenameLayer(PAGE, 'g', 'g', 'g')
      expect(editor.canUndo).toBe(false)
    })
  })

  describe('blending', () => {
    const opacityOf = (project: ReturnType<typeof useProjectStore>, id: string) =>
      findEntry(project.pageById(PAGE)?.page.layers ?? [], id)?.opacity

    const blendOf = (project: ReturnType<typeof useProjectStore>, id: string) =>
      findEntry(project.pageById(PAGE)?.page.layers ?? [], id)?.blendMode

    it('fades everything selected in one step of history', () => {
      const { project, editor } = openTree([label('a'), label('b'), label('c')], ['a', 'b', 'c'])
      const before = [
        { pageId: PAGE, id: 'a', opacity: 1 },
        { pageId: PAGE, id: 'b', opacity: 1 },
      ]
      for (const { id } of before) project.setLayerOpacity(PAGE, id, 0.4)

      editor.cmdSetOpacity(before, 0.4)

      expect([opacityOf(project, 'a'), opacityOf(project, 'b')]).toEqual([0.4, 0.4])
      expect(opacityOf(project, 'c')).toBe(1)

      editor.undo()
      expect([opacityOf(project, 'a'), opacityOf(project, 'b')]).toEqual([1, 1])
    })

    // A slider nudged and put back is not something anyone wants to undo.
    it('keeps an opacity that came back where it started out of the stack', () => {
      const { editor } = openTree([label('a')], ['a'])
      editor.cmdSetOpacity([{ pageId: PAGE, id: 'a', opacity: 1 }], 1)
      expect(editor.canUndo).toBe(false)
    })

    it('changes a blend mode and puts it back', () => {
      const { project, editor } = openTree([label('a')], ['a'])

      editor.cmdSetBlendMode([{ pageId: PAGE, id: 'a', blendMode: 'normal' }], 'multiply')
      expect(blendOf(project, 'a')).toBe('multiply')

      editor.undo()
      expect(blendOf(project, 'a')).toBe('normal')
    })

    /**
     * Pass-through says "no buffer of my own", which only a container has one
     * to decline — and a manifest carrying it anywhere else will not parse.
     */
    it('refuses pass-through on anything that is not a folder', () => {
      const { project, editor } = openTree([label('a'), folder('g', [])], ['a'])

      editor.cmdSetBlendMode([{ pageId: PAGE, id: 'a', blendMode: 'normal' }], PASS_THROUGH)
      expect(blendOf(project, 'a')).toBe('normal')
      // And it leaves no entry that would undo to nothing.
      expect(editor.canUndo).toBe(false)

      editor.cmdSetBlendMode([{ pageId: PAGE, id: 'g', blendMode: 'normal' }], PASS_THROUGH)
      expect(blendOf(project, 'g')).toBe(PASS_THROUGH)
    })

    /** A folder among rasters still takes the mode; only the refusal is skipped. */
    it('records the part of a mixed selection that took the mode', () => {
      const { project, editor } = openTree([label('a'), folder('g', [])], ['a'])
      project.setLayerBlendMode(PAGE, 'g', 'multiply')

      editor.cmdSetBlendMode(
        [
          { pageId: PAGE, id: 'a', blendMode: 'normal' },
          { pageId: PAGE, id: 'g', blendMode: 'multiply' },
        ],
        PASS_THROUGH,
      )

      expect(blendOf(project, 'a')).toBe('normal')
      expect(blendOf(project, 'g')).toBe(PASS_THROUGH)

      editor.undo()
      expect(blendOf(project, 'g')).toBe('multiply')
      expect(blendOf(project, 'a')).toBe('normal')
    })

    /**
     * The panel takes the whole selection rather than the part of it on the
     * open page, and it says how far that reaches before anyone touches a
     * control. What is out of sight is therefore in reach and said out loud —
     * the alternative is a slider that silently does less than the count above
     * it claims.
     */
    it('reaches everything selected, whichever page it is on', () => {
      const { project, editor } = openTree([label('a'), label('b')], ['a', 'b'])
      project.allFiles.push({
        pageId: 'p002.png',
        pageDir: '/x/p002.png',
        page: {
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          revision: 0,
          name: 'p',
          width: 1200,
          height: 1700,
          translationUnits: [], readingOrder: ['z'],
          readingEdges: [],
          layers: [label('z')],
        },
        ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
        badge: 'ok',
      })
      editor.selectOnly('a')
      editor.toggleSelected('z')
      editor.currentPageId = PAGE

      expect(editor.selectedNodes().map((t) => t.entry.id).sort()).toEqual(['a', 'z'])
      expect(editor.batchScope).toEqual({ objects: 2, pages: 2, offPage: true })

      // The panel writes straight through and records on release, so the step
      // that has to reach both pages is the one that puts them back.
      const before = editor.selectedNodes().map((t) => ({
        pageId: t.pageId,
        id: t.entry.id,
        opacity: t.entry.opacity,
      }))
      for (const { pageId, id } of before) project.setLayerOpacity(pageId, id, 0.5)
      editor.cmdSetOpacity(before, 0.5)

      const away = () => findEntry(project.pageById('p002.png')?.page.layers ?? [], 'z')?.opacity
      expect([opacityOf(project, 'a'), away()]).toEqual([0.5, 0.5])

      editor.undo()
      expect([opacityOf(project, 'a'), away()]).toEqual([1, 1])
    })
  })

  /**
   * The whole of what the outer panel decides. It reads `kind` off a node and
   * nothing else, so these five answers are the entire interface between it and
   * the consumers below.
   */
  describe('who a selection is handed to', () => {
    it('has nobody to hand nothing to', () => {
      const { editor } = openTree([label('a')], ['a'])
      expect(editor.appearanceKind).toBe('none')
    })

    it('hands a run of text objects to the text consumer', () => {
      const { editor } = openTree([label('a'), label('b')], ['a', 'b'])
      editor.selectOnly('a')
      editor.toggleSelected('b')
      expect(editor.appearanceKind).toBe('text')
    })

    it('hands a run of layers to the layer consumer', () => {
      const { editor } = openTree([raster('r1'), raster('r2')], [])
      editor.selectOnly('r1')
      editor.toggleSelected('r2')
      expect(editor.appearanceKind).toBe('raster')
    })

    it('calls a selection that disagrees about what it holds a mixture', () => {
      const { editor } = openTree([label('a'), raster('r')], ['a'])
      editor.selectOnly('a')
      editor.toggleSelected('r')
      expect(editor.appearanceKind).toBe('mixed')
    })

    /**
     * A folder is a kind with nothing of its own to adjust yet, which is a
     * different sentence from "these disagree" — and only the second is worth
     * saying out loud to whoever is looking at the panel.
     */
    it('calls a folder a folder rather than a mixture', () => {
      const { editor } = openTree([folder('g', [])], [])
      editor.selectOnly('g')
      expect(editor.appearanceKind).toBe('group')
    })

    /** A locked node is out of reach, so it is not part of what is handed over. */
    it('leaves a locked node out of the batch entirely', () => {
      const { project, editor } = openTree([label('a'), raster('r')], ['a'])
      project.setLayerLocked(PAGE, 'r', true)
      editor.selectOnly('a')
      editor.toggleSelected('r')

      expect(editor.appearanceKind).toBe('text')
      expect(editor.batchScope).toEqual({ objects: 1, pages: 1, offPage: false })
    })

    /** Counted by node, not by text object: a layer is something to adjust too. */
    it('counts every kind of node the batch reaches', () => {
      const { editor } = openTree([label('a'), raster('r'), folder('g', [])], ['a'])
      editor.selectOnly('a')
      editor.toggleSelected('r')
      editor.toggleSelected('g')
      expect(editor.batchScope.objects).toBe(3)
    })
  })

  describe('effects on the batch', () => {
    const STROKE = { kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' } as const
    const effectsOf = (project: ReturnType<typeof useProjectStore>, id: string) =>
      findEntry(project.pageById(PAGE)?.page.layers ?? [], id)?.effects

    /** The point of the whole batch: a layer wears one exactly as an object does. */
    it('puts a stroke on layers and objects alike, in one step', () => {
      const { project, editor } = openTree([label('a'), raster('r')], ['a'])
      editor.selectOnly('a')
      editor.toggleSelected('r')

      editor.cmdApplyEffects(editor.selectedNodes(), [STROKE])
      expect([effectsOf(project, 'a'), effectsOf(project, 'r')]).toEqual([[STROKE], [STROKE]])

      editor.undo()
      expect([effectsOf(project, 'a'), effectsOf(project, 'r')]).toEqual([[], []])
    })

    /** Two nodes handed one array would have the first in-place edit change both. */
    it('gives each node a list of its own', () => {
      const { project, editor } = openTree([raster('r1'), raster('r2')], [])
      editor.selectOnly('r1')
      editor.toggleSelected('r2')

      editor.cmdApplyEffects(editor.selectedNodes(), [STROKE])

      expect(effectsOf(project, 'r1')).not.toBe(effectsOf(project, 'r2'))
      expect(effectsOf(project, 'r1')?.[0]).not.toBe(effectsOf(project, 'r2')?.[0])
    })

    /**
     * The command writes what it was handed rather than going back to ask the
     * selection — which is what keeps the panel a person read and the write that
     * followed from ever being about two different batches.
     */
    it('writes the targets it was given and not the selection', () => {
      const { project, editor } = openTree([raster('r1'), raster('r2')], [])
      editor.selectOnly('r1')
      editor.toggleSelected('r2')

      editor.cmdApplyEffects(editor.selectedNodes().slice(0, 1), [STROKE])

      expect(effectsOf(project, 'r1')).toEqual([STROKE])
      expect(effectsOf(project, 'r2')).toEqual([])
    })

    it('shows a preview at once and undoes the whole gesture in one step', () => {
      const { project, editor } = openTree([raster('r')], [])
      editor.selectOnly('r')
      editor.cmdApplyEffects(editor.selectedNodes(), [STROKE])
      const red = { ...STROKE, color: '#ff0000' }
      const blue = { ...STROKE, color: '#0000ff' }

      editor.previewEffects(editor.selectedNodes(), [red])
      expect(effectsOf(project, 'r')).toEqual([red])
      editor.previewEffects(editor.selectedNodes(), [blue])
      editor.cmdApplyEffects(editor.selectedNodes(), [blue])
      expect(effectsOf(project, 'r')).toEqual([blue])

      editor.undo()
      expect(effectsOf(project, 'r')).toEqual([STROKE])
    })
  })

  describe('style on the batch', () => {
    const styleOf = (project: ReturnType<typeof useProjectStore>, id: string) =>
      (findEntry(project.pageById(PAGE)?.page.layers ?? [], id) as TextLayerEntry).body.style

    /** Each object keeps its own other fields through the preview; one undo puts them all back. */
    it('previews a colour across objects of different sizes and undoes it in one step', () => {
      const big = label('a')
      big.body.style.fontSizePx = 96
      const { project, editor } = openTree([big, label('b')], ['a', 'b'])
      editor.selectOnly('a')
      editor.toggleSelected('b')
      const targets = editor.selectedNodes() as AppearanceTarget<TextLayerEntry>[]

      editor.previewStyle(targets, { color: '#ff0000' })
      editor.previewStyle(targets, { color: '#0000ff' })
      expect(styleOf(project, 'a')).toMatchObject({ color: '#0000ff', fontSizePx: 96 })
      editor.cmdApplyStyle(targets, { color: '#0000ff' })

      editor.undo()
      expect(styleOf(project, 'a').color).toBe(DEFAULT_TEXT_STYLE.color)
      expect(styleOf(project, 'b').color).toBe(DEFAULT_TEXT_STYLE.color)
      expect(styleOf(project, 'a').fontSizePx).toBe(96)
    })
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
      effects: [],
      children,
    }
  }

  function open(pages: Array<{ name: string; layers: LayerEntry[]; order: string[] }>) {
    const project = useProjectStore()
    project.allFiles = pages.map((p) => ({
      pageId: p.name,
      pageDir: `/x/${p.name}`,
      ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        name: 'p',
        width: 1200,
        height: 1700,
        translationUnits: p.order.map(unitFor),
        readingOrder: p.order,
        readingEdges: [],
        layers: [...p.layers, ...p.order.map(sourceFor)],
      },
      badge: 'ok' as const,
    }))
    const editor = useEditorStore()
    editor.currentPageId = pages[0].name
    return { project, editor }
  }

  const orderOf = (project: ReturnType<typeof useProjectStore>, name: string): string[] =>
    project.pageById(name)?.page.readingOrder ?? []

  const stackOf = (project: ReturnType<typeof useProjectStore>, name: string): string[] =>
    (project.pageById(name)?.page.layers ?? [])
      .filter((e) => !(e.kind === 'text' && e.side === 'source'))
      .map((e) => e.id)

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

    expect(editor.currentPageId).toBe('p1')
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

    expect(editor.currentPageId).toBe('p1')
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
      effects: [],
      children,
    }
  }

  function openTree(layers: LayerEntry[], order: string[]) {
    const project = useProjectStore()
    project.allFiles = [
      {
        pageId: PAGE,
        pageDir: `/x/${PAGE}`,
        ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
        page: {
          schemaVersion: MANIFEST_SCHEMA_VERSION,
          revision: 0,
          name: 'p',
          width: 1200,
          height: 1700,
          translationUnits: [], readingOrder: order,
          readingEdges: [],
          layers,
        },
        badge: 'ok' as const,
      },
    ]
    const editor = useEditorStore()
    editor.currentPageId = PAGE
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
    expect(editor.pendingTextEdit).toEqual({
      pageId: PAGE,
      labelId: 'b',
      from: 'b0',
      side: 'translation',
      wasTheirs: false,
    })
  })

  it('carries on to the next page at the end of this one', () => {
    const project = useProjectStore()
    project.allFiles = [pageOf('001.png', [label('a')]), pageOf('002.png', [label('b', 'b0')])]
    const editor = useEditorStore()
    editor.currentPageId = '001.png'
    editor.selectOnly('a')
    editor.beginTextEdit('001.png', 'a', '')

    editor.editBy(1)

    expect(editor.currentPageId).toBe('002.png')
    expect(editor.pendingTextEdit).toEqual({
      pageId: '002.png',
      labelId: 'b',
      from: 'b0',
      side: 'translation',
      wasTheirs: false,
    })
  })
})

describe('moveObjectsTo', () => {
  function open(
    pages: Array<{
      name: string
      layers: LayerEntry[]
      order: string[]
      drawn?: Array<{ from: string; to: string }>
    }>,
  ) {
    const project = useProjectStore()
    project.allFiles = pages.map((p) => ({
      pageId: p.name,
      pageDir: `/x/${p.name}`,
      ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        name: 'p',
        width: 1200,
        height: 1700,
        translationUnits: p.order.map(unitFor),
        readingOrder: p.order,
        readingEdges: p.drawn ?? [],
        layers: [...p.layers, ...p.order.map(sourceFor)],
      },
      badge: 'ok' as const,
    }))
    const editor = useEditorStore()
    editor.currentPageId = pages[0].name
    return { project, editor }
  }

  const orderOf = (project: ReturnType<typeof useProjectStore>, name: string): string[] =>
    project.pageById(name)?.page.readingOrder ?? []

  const stackOf = (project: ReturnType<typeof useProjectStore>, name: string): string[] =>
    (project.pageById(name)?.page.layers ?? [])
      .filter((e) => !(e.kind === 'text' && e.side === 'source'))
      .map((e) => e.id)

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

  const edgesOf = (project: ReturnType<typeof useProjectStore>, name: string) =>
    project.pageById(name)?.page.readingEdges ?? []

  it('carries a line to the new page when both its ends make the journey', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b')], order: ['a', 'b'], drawn: [{ from: 'a', to: 'b' }] },
      { name: 'p2', layers: [], order: [] },
    ])

    editor.moveObjectsTo(['a', 'b'], 'p2', 0)

    expect(edgesOf(project, 'p2')).toEqual([{ from: 'a', to: 'b' }])
    expect(edgesOf(project, 'p1')).toEqual([])
  })

  /**
   * An id means something only within its page, so a line reaching back to one
   * left behind has nothing to point at. Dropping it is the answer; carrying it
   * would leave the new page holding a line to an object that is not on it.
   */
  it('drops a line whose other end stayed behind', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b')], order: ['a', 'b'], drawn: [{ from: 'a', to: 'b' }] },
      { name: 'p2', layers: [], order: [] },
    ])

    editor.moveObjectsTo(['a'], 'p2', 0)

    expect(edgesOf(project, 'p2')).toEqual([])
    expect(edgesOf(project, 'p1')).toEqual([])
  })

  it('gives a carried line back to the page it came from when undone', () => {
    const { project, editor } = open([
      { name: 'p1', layers: [label('a'), label('b')], order: ['a', 'b'], drawn: [{ from: 'a', to: 'b' }] },
      { name: 'p2', layers: [], order: [] },
    ])

    editor.moveObjectsTo(['a', 'b'], 'p2', 0)
    editor.undo()

    expect(edgesOf(project, 'p1')).toEqual([{ from: 'a', to: 'b' }])
    expect(edgesOf(project, 'p2')).toEqual([])
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
    project.allFiles = [
      pageOf('001.png', [label('a'), label('b')]),
      pageOf('002.png', [label('c'), label('d')]),
    ]
    const editor = useEditorStore()
    editor.currentPageId = '001.png'
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
    expect(editor.currentPageId).toBe('002.png')
    expect([...editor.selectedIds].sort()).toEqual(['a', 'c'])
  })

  it('turns to the page a range was reached out to', () => {
    const { editor } = open()

    editor.extendSelectionTo('c', ['a', 'b', 'c', 'd'])

    expect(editor.currentPageId).toBe('002.png')
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
    expect(editor.currentPageId).toBe('002.png')
  })

  it('leaves the page alone when the selection empties', () => {
    const { editor } = open()

    editor.toggleSelected('a')

    expect(editor.cursorId).toBeNull()
    expect(editor.currentPageId).toBe('001.png')
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
    project.allFiles = [
      pageOf('001.png', [label('a', 'そうか'), label('b', 'やめろ'), label('c', 'そうだね')]),
      pageOf('002.png', [label('d', 'まって')]),
    ]
    const editor = useEditorStore()
    editor.currentPageId = '001.png'
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
    expect(editor.currentPageId).toBe('002.png')
  })

  /** An empty page is somewhere the cursor can be, and its heading is the stop. */
  it('comes to rest on a page with nothing on it', () => {
    const project = useProjectStore()
    project.allFiles = [pageOf('001.png', [label('a')]), pageOf('002.png', []), pageOf('003.png', [label('c')])]
    const editor = useEditorStore()
    editor.currentPageId = '001.png'
    editor.selectOnly('a')

    editor.selectLabelBy(1)
    expect(editor.currentPageId).toBe('002.png')
    expect(editor.cursorId).toBeNull()

    editor.selectLabelBy(1)
    expect(editor.cursorId).toBe('c')
  })
})

describe('spraying tags with the brush', () => {
  function styled(id: string, tags: string[], style: Partial<TextStyle>): TextLayerEntry {
    const entry = label(id)
    entry.body.style = { ...DEFAULT_TEXT_STYLE, ...style }
    Object.assign(entry, { __tags: tags })
    return entry
  }

  function openSprayed(labels: TextLayerEntry[]) {
    const { project, editor } = openOnePage(labels)
    // The meaning lives one level up, so it is written after the page is built.
    for (const entry of labels) {
      const tags = (entry as unknown as { __tags?: string[] }).__tags ?? []
      if (tags.length > 0) project.setLabelTags(PAGE, entry.id, tags)
    }
    project.addTag('outside')
    project.addTag('emphasis')
    return { project, editor }
  }

  const tagsOf = (project: ReturnType<typeof useProjectStore>, id: string) =>
    project.unitById(PAGE, id)!.tags

  it('replaces the meaning an object carried rather than joining it', () => {
    const { project, editor } = openSprayed([styled('a', ['emphasis'], {})])

    editor.cmdPaintTags(['a'], ['outside'])

    expect(tagsOf(project, 'a')).toEqual(['outside'])
  })

  it('takes a meaning away when nothing is loaded', () => {
    const { project, editor } = openSprayed([styled('a', ['outside', 'emphasis'], {})])

    editor.cmdPaintTags(['a'], [])

    expect(tagsOf(project, 'a')).toEqual([])
  })

  /** One sweep is one thing that happened, however many objects it crossed. */
  it('puts a whole sweep back in one undo', () => {
    const { project, editor } = openSprayed([
      styled('a', [], {}),
      styled('b', ['emphasis'], {}),
      styled('c', [], {}),
    ])

    editor.cmdPaintTags(['a', 'b', 'c'], ['outside'])
    editor.undo()

    expect(tagsOf(project, 'a')).toEqual([])
    expect(tagsOf(project, 'b')).toEqual(['emphasis'])
    expect(tagsOf(project, 'c')).toEqual([])
  })

  it('gives a sprayed object the style its new meaning already has', () => {
    const { project, editor } = openSprayed([
      styled('new', [], { fontFamily: 'Seed' }),
      ...Array.from({ length: 5 }, (_, i) =>
        styled(`s${i}`, ['outside'], { fontFamily: 'Mincho' }),
      ),
    ])

    editor.cmdPaintTags(['new'], ['outside'])

    expect(project.blockById(PAGE, 'new')!.body.style.fontFamily).toBe('Mincho')

    editor.undo()

    expect(project.blockById(PAGE, 'new')!.body.style.fontFamily).toBe('Seed')
  })

  /**
   * The number on the button. One meaning is a batch that keeps what it finds;
   * anything above one is being flattened, and that is what has to be visible
   * before the press.
   */
  it('counts the meanings a batch would flatten, not just the objects', () => {
    const { editor } = openSprayed([
      styled('a', ['outside'], {}),
      styled('b', ['outside'], {}),
      styled('c', ['emphasis'], {}),
      styled('d', [], {}),
    ])

    editor.selectMany(['a', 'b'], false)
    expect(editor.paintTargetScope).toEqual({ objects: 2, meanings: 1 })

    editor.selectMany(['a', 'b', 'c', 'd'], false)
    expect(editor.paintTargetScope).toEqual({ objects: 4, meanings: 3 })

    editor.selectOnly(null)
    expect(editor.paintTargetScope).toEqual({ objects: 0, meanings: 0 })
  })

  /** Held, the key turns the switch over — whichever way it was standing. */
  it('reads the held key as turning the switch over, not as one fixed answer', () => {
    const editor = useEditorStore()

    expect(editor.paintUpdatesStyle).toBe(true)
    expect(editor.paintStrokeUpdatesStyle).toBe(true)

    editor.overrideHeld = true
    expect(editor.paintStrokeUpdatesStyle).toBe(false)

    editor.paintUpdatesStyle = false
    expect(editor.paintStrokeUpdatesStyle).toBe(true)

    editor.overrideHeld = false
    expect(editor.paintStrokeUpdatesStyle).toBe(false)
  })

  /**
   * The switch off, or Ctrl held: the pass is correcting a label, and the page
   * is already laid out.
   */
  it('leaves the style alone when the stroke does not update it', () => {
    const { project, editor } = openSprayed([
      styled('mine', ['emphasis'], { fontFamily: 'Chosen', color: '#abcdef' }),
      ...Array.from({ length: 5 }, (_, i) =>
        styled(`s${i}`, ['outside'], { fontFamily: 'Mincho' }),
      ),
    ])

    editor.cmdPaintTags(['mine'], ['outside'], false)

    expect(tagsOf(project, 'mine')).toEqual(['outside'])
    expect(project.blockById(PAGE, 'mine')!.body.style).toMatchObject({
      fontFamily: 'Chosen',
      color: '#abcdef',
    })
  })

  it('still puts the tags back on undo when the style was left alone', () => {
    const { project, editor } = openSprayed([styled('mine', ['emphasis'], {})])

    editor.cmdPaintTags(['mine'], ['outside'], false)
    editor.undo()

    expect(tagsOf(project, 'mine')).toEqual(['emphasis'])
  })

  /** Nothing changed is nothing to undo — a sweep over what already says this. */
  it('records nothing when every object already carries the load', () => {
    const { editor } = openSprayed([styled('a', ['outside'], {})])
    while (editor.canUndo) editor.undo()

    editor.cmdPaintTags(['a'], ['outside'])

    expect(editor.canUndo).toBe(false)
  })
})

describe('drawing lines between text objects', () => {
  const edgesOf = (project: ReturnType<typeof useProjectStore>) =>
    project.pageById(PAGE)?.page.readingEdges ?? []

  it('draws a line and takes it back in one step', () => {
    const { project, editor } = openOnePage([label('a'), label('b')])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    expect(edgesOf(project)).toEqual([{ from: 'a', to: 'b' }])
    editor.undo()
    expect(edgesOf(project)).toEqual([])
    editor.redo()
    expect(edgesOf(project)).toEqual([{ from: 'a', to: 'b' }])
  })

  /**
   * The whole point of chaining: connecting five objects in one gesture is one
   * thing that happened, so Ctrl+Z takes back the chain and not its last link.
   */
  it('puts a chain drawn in one gesture on the stack as one entry', () => {
    const { project, editor } = openOnePage([label('a'), label('b'), label('c')])
    editor.cmdDrawReadingEdges(PAGE, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ])
    expect(edgesOf(project)).toHaveLength(2)
    editor.undo()
    expect(edgesOf(project)).toEqual([])
  })

  it('refuses the line that would close a ring', () => {
    const { project, editor } = openOnePage([label('a'), label('b')])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'b', to: 'a' }])
    expect(edgesOf(project)).toEqual([{ from: 'a', to: 'b' }])
  })

  it('refuses a ring the gesture would have closed against its own earlier link', () => {
    const { project, editor } = openOnePage([label('a'), label('b'), label('c')])
    editor.cmdDrawReadingEdges(PAGE, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ])
    expect(edgesOf(project)).toHaveLength(2)
  })

  /**
   * Taking back a gesture must not take back a line that was already there —
   * undo puts the page back as it was, and it was holding that one.
   */
  it('leaves a line already drawn alone when a gesture that repeats it is undone', () => {
    const { project, editor } = openOnePage([label('a'), label('b'), label('c')])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    editor.cmdDrawReadingEdges(PAGE, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ])
    editor.undo()
    expect(edgesOf(project)).toEqual([{ from: 'a', to: 'b' }])
  })

  it('leaves nothing on the stack for a gesture that drew nothing', () => {
    const { editor } = openOnePage([label('a'), label('b')])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'a' }])
    expect(editor.canUndo).toBe(false)
  })

  it('rubs a line out and puts it back', () => {
    const { project, editor } = openOnePage([label('a'), label('b')])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    editor.cmdEraseReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    expect(edgesOf(project)).toEqual([])
    editor.undo()
    expect(edgesOf(project)).toEqual([{ from: 'a', to: 'b' }])
  })

  /**
   * Deleting an object takes its lines with it, and one undo brings both back.
   * Leaving the lines behind would hand a batch of ends pointing at nothing to
   * `repair`, which drops them at the next open — so the undo would look like
   * it worked and the lines would be gone the next morning.
   */
  it('takes the lines on a deleted object with it, and gives them back', () => {
    const { project, editor } = openOnePage([label('a'), label('b'), label('c')])
    editor.cmdDrawReadingEdges(PAGE, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ])
    editor.selectOnly('b')
    editor.deleteSelection()
    expect(edgesOf(project)).toEqual([])
    editor.undo()
    expect(edgesOf(project)).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ])
  })

  it('takes the lines inside a deleted folder with it', () => {
    const a = label('a')
    const b = label('b')
    const { project, editor } = openOnePage([])
    const file = project.pageById(PAGE)
    if (!file) throw new Error('page missing')
    file.page.layers = [
      {
        kind: 'group',
        id: 'g',
        name: '對白',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: PASS_THROUGH,
        effects: [],
        children: [a, b],
      },
      sourceFor('a'),
      sourceFor('b'),
    ]
    file.page.translationUnits = [unitFor('a'), unitFor('b')]
    file.page.readingOrder = ['a', 'b']
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    editor.selectOnly('g')
    editor.deleteSelection()
    expect(edgesOf(project)).toEqual([])
    editor.undo()
    expect(edgesOf(project)).toEqual([{ from: 'a', to: 'b' }])
  })

  it('takes the lines on an object with it when its creation is undone', () => {
    const { project, editor } = openOnePage([label('a')])
    editor.cmdAddLabel(PAGE, { unit: unitFor('b'), blocks: [label('b'), sourceFor('b')] })
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    editor.undo()
    editor.undo()
    expect(edgesOf(project)).toEqual([])
    editor.redo()
    expect(project.labelsOf(PAGE).map((l) => l.id)).toEqual(['a', 'b'])
  })
})

describe('reordering the chapter', () => {
  function openPages(ids: string[]) {
    const project = useProjectStore()
    project.allFiles = ids.map((id) => pageOf(id, []))
    project.metaDirty = false
    return { project, editor: useEditorStore() }
  }

  const order = (project: ReturnType<typeof useProjectStore>) =>
    project.files.map((f) => f.pageId)

  it('moves a page forward to where it was dropped', () => {
    const { project, editor } = openPages(['a', 'b', 'c', 'd'])
    editor.cmdMovePage('a', 2)
    expect(order(project)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('moves a page backward to where it was dropped', () => {
    const { project, editor } = openPages(['a', 'b', 'c', 'd'])
    editor.cmdMovePage('d', 1)
    expect(order(project)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('moves a page to the end', () => {
    const { project, editor } = openPages(['a', 'b', 'c'])
    editor.cmdMovePage('a', 2)
    expect(order(project)).toEqual(['b', 'c', 'a'])
  })

  /**
   * The easiest page-level act to do by accident: a page dragged three cells
   * sideways in a chapter of two hundred is not something anyone notices.
   */
  it('takes a drop back, and puts it forward again', () => {
    const { project, editor } = openPages(['a', 'b', 'c', 'd'])
    editor.cmdMovePage('d', 1)
    editor.undo()
    expect(order(project)).toEqual(['a', 'b', 'c', 'd'])
    editor.redo()
    expect(order(project)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('has nothing to record for a drop that changed nothing', () => {
    const { project, editor } = openPages(['a', 'b', 'c'])
    editor.cmdMovePage('b', 1)
    expect(editor.canUndo).toBe(false)
    expect(order(project)).toEqual(['a', 'b', 'c'])
  })

  /**
   * A command that had recorded an index would put the page back a place short
   * once something ahead of it had left the list; anchored to the page that
   * used to follow it, it lands where it belongs.
   */
  it('still puts a page back after another one has been deleted', () => {
    const { project, editor } = openPages(['a', 'b', 'c', 'd'])
    editor.cmdMovePage('d', 0)
    expect(order(project)).toEqual(['d', 'a', 'b', 'c'])
    project.tagPagesDeleted(['b'])
    editor.undo()
    expect(order(project)).toEqual(['a', 'c', 'd'])
  })

  it('marks the document so the new order reaches disk', () => {
    const { project, editor } = openPages(['a', 'b'])
    editor.cmdMovePage('b', 0)
    expect(project.metaDirty).toBe(true)
  })
})

/**
 * `cmdSetPageOrder` and `cmdImportPages` are the first commands whose writer
 * can refuse — a handle that is gone, or a chapter that has since gained a
 * page the snapshot never saw. Each has to leave the stack exactly where it
 * was and say so, rather than advancing past a write that never happened.
 */
describe('a refused write does not advance the stack', () => {
  const BOOK = '/library/book-a'

  function stubBookApi(pages: string[], onWrite: () => void = () => {}) {
    vi.stubGlobal('window', {
      api: {
        readProjectMeta: async () => serializeProjectJson({ ...defaultProjectJson(), pages }),
        writeProjectMeta: async () => onWrite(),
      },
    })
  }

  /**
   * The undo itself went back — the order in memory is the old one. What did
   * not happen is the write, and nothing was waiting on it: a scheduled write
   * reports through `onError`, which is the console. The next open would have
   * shown the order this key press took away.
   */
  it('says so when the write behind an undo does not reach the disk', async () => {
    stubBookApi(['a', 'b'], () => {
      throw new Error('disk full')
    })
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(BOOK)

    editor.cmdSetPageOrder(BOOK, ['a', 'b'], ['b', 'a'])
    useNoticeStore().dismiss()

    editor.undo(BOOK)
    await vi.waitFor(() => expect(useNoticeStore().notice?.text).toContain('沒有存進磁碟'))

    expect(bookMeta.orderOf(BOOK)?.pages).toEqual(['a', 'b'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * "Reorder → open → undo", the sequence that used to do nothing at all.
   * The command holds the book's path, not the writer that was live when the
   * shelf let go, so opening the book moves the undo onto `projectStore`
   * rather than stranding it on a session the open had just deleted.
   */
  it('undoes through projectStore once the book has since been opened', async () => {
    stubBookApi(['a', 'b'])
    const project = useProjectStore()
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(BOOK)

    editor.cmdSetPageOrder(BOOK, ['a', 'b'], ['b', 'a'])

    project.rootPath = BOOK
    project.allFiles = [pageOf('b', []), pageOf('a', [])]

    editor.undo()

    expect(project.allFiles.map((f) => f.pageId)).toEqual(['a', 'b'])
    expect(editor.canUndo).toBe(false)
  })

  it('refuses an undo once the handle has been forgotten, and says so', async () => {
    stubBookApi(['a', 'b'])
    const project = useProjectStore()
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(BOOK)

    editor.cmdSetPageOrder(BOOK, ['a', 'b'], ['b', 'a'])

    // Read with the book open, since `canUndo` only ever answers for
    // whichever book is current — the check itself does not open it.
    project.rootPath = BOOK
    expect(editor.canUndo).toBe(true)
    project.rootPath = null

    bookMeta.forget(BOOK)
    editor.undo(BOOK)

    project.rootPath = BOOK
    expect(editor.canUndo).toBe(true)
    expect(useNoticeStore().notice?.text).toBeTruthy()
  })

  it('refuses an undo once the chapter no longer matches the order it remembers', () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.rootPath = BOOK
    project.allFiles = [pageOf('a', []), pageOf('b', [])]

    editor.cmdSetPageOrder(BOOK, ['a', 'b'], ['b', 'a'])
    expect(project.files.map((f) => f.pageId)).toEqual(['b', 'a'])

    // A page arrived from outside this command — an import committed after
    // the drag — so `before` is no longer an exact permutation of the pool.
    project.allFiles = [...project.allFiles, pageOf('c', [])]

    editor.undo()

    expect(project.files.map((f) => f.pageId)).toEqual(['b', 'a', 'c'])
    expect(editor.canUndo).toBe(true)
    expect(useNoticeStore().notice?.text).toBeTruthy()
  })

  /**
   * A redo of an import lifts the tombstone and does nothing else. Its `after`
   * describes the chapter as it stood at the drop, and a page that arrived
   * since is not something that snapshot can speak for — replaying it would
   * put the newcomer wherever the old order left a slot going spare.
   */
  it('redoes an import by lifting its tombstone, leaving a page that arrived since where it is', () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.rootPath = BOOK
    project.allFiles = [pageOf('a', [])]

    editor.cmdImportPages(BOOK, ['p'], [pageOf('p', [])], ['p', 'a'])
    expect(project.files.map((f) => f.pageId)).toEqual(['p', 'a'])

    editor.undo()
    expect(project.projectMeta.deletedPages).toEqual(['p'])

    // A page arrived from outside this command between the undo and the redo.
    project.allFiles = [...project.allFiles, pageOf('q', [])]

    editor.redo()

    expect(project.projectMeta.deletedPages).toEqual([])
    expect(project.files.map((f) => f.pageId)).toEqual(['p', 'a', 'q'])
    expect(editor.canRedo).toBe(false)
  })
})

describe('a reading dropped on an object that already had one', () => {
  const reading = (hash: string, text: string): OcrCandidatePersisted => ({
    hash,
    source: 'manga-ocr',
    text,
    original: text,
    x: 100,
    y: 100,
    w: 200,
    h: 400,
    confidence: 0.99,
    label: 'text_bubble',
  })

  function standingOn(hash: string, text: string): TextLayerEntry {
    const entry = label('a')
    Object.assign(entry, { __source: { lines: linesOf(text), from: hash } })
    return entry
  }

  /** Writes the artwork's words after the page exists, since they live next door. */
  function openStanding(labels: TextLayerEntry[]) {
    const opened = openOnePage(labels)
    for (const entry of labels) {
      const said = (entry as unknown as { __source?: { lines: string[]; from: string } }).__source
      if (said === undefined) continue
      const body = sourceOf(opened.project, entry.id)
      body.lines = said.lines
      body.from = said.from
      body.x = 300
      body.y = 420
      body.rotation = 0.4
    }
    return opened
  }

  const offering = (
    project: ReturnType<typeof useProjectStore>,
    pool: readonly OcrCandidatePersisted[],
  ): string[] =>
    offeredReadings(
      pool,
      blocksOnSide(project.pageById(PAGE)!.page.layers, 'source').map((b) => ({
        source: { from: (b as SourceTextLayerEntry).body.from },
      })),
    ).map((r) => r.hash)

  it('says what the new reading says, and stops saying what the old one did', () => {
    const { project, editor } = openStanding([standingOn('was', 'あいつ')])
    editor.cmdReplaceLabelSource(PAGE, SOURCE_OF('a'), reading('now', 'おいつ'))
    expect(sourceOf(project, 'a').lines.join('\n')).toBe('おいつ')
  })

  /**
   * ⭐ The whole of the bookkeeping, and there is none: the edge hangs on the
   * object, so pointing it somewhere else hands the old reading back by itself.
   */
  it('hands the reading it was standing on back to the page, and takes up the new one', () => {
    const pool = [reading('was', 'あいつ'), reading('now', 'おいつ')]
    const { project, editor } = openStanding([standingOn('was', 'あいつ')])
    expect(offering(project, pool)).toEqual(['now'])
    editor.cmdReplaceLabelSource(PAGE, SOURCE_OF('a'), pool[1])
    expect(offering(project, pool)).toEqual(['was'])
  })

  /**
   * Picking this reading over the one the run chose is the judgement a rerun
   * must not quietly undo — so the fence records who settled it, not who typed
   * the characters.
   */
  it('stamps the object as settled by hand', () => {
    const { project, editor } = openStanding([standingOn('was', 'あいつ')])
    editor.cmdReplaceLabelSource(PAGE, SOURCE_OF('a'), reading('now', 'おいつ'))
    expect(sourceOf(project, 'a').by).toBe('human')
  })

  /** What a drop on an object says is "the contents are wrong", and no more. */
  it('leaves the object standing exactly where it was, set as it was', () => {
    const { project, editor } = openStanding([standingOn('was', 'あいつ')])
    const before = sourceOf(project, labelsOf(project)[0]!.id)
    const was = { x: before.x, y: before.y, rotation: before.rotation, style: before.style }
    editor.cmdReplaceLabelSource(PAGE, SOURCE_OF('a'), reading('now', 'おいつ'))
    const after = sourceOf(project, labelsOf(project)[0]!.id)
    expect({ x: after.x, y: after.y, rotation: after.rotation, style: after.style }).toEqual(was)
  })

  it('takes the replacement back, words and fence together', () => {
    const pool = [reading('was', 'あいつ'), reading('now', 'おいつ')]
    const { project, editor } = openStanding([standingOn('was', 'あいつ')])
    editor.cmdReplaceLabelSource(PAGE, SOURCE_OF('a'), pool[1])
    editor.undo()
    expect(sourceOf(project, 'a').lines.join('\n')).toBe('あいつ')
    expect(sourceOf(project, 'a').by).toBe('auto')
    expect(offering(project, pool)).toEqual(['now'])
  })

  it('has nothing to record for a drop of the reading already standing there', () => {
    const { project, editor } = openStanding([standingOn('was', 'あいつ')])
    editor.cmdReplaceLabelSource(PAGE, SOURCE_OF('a'), reading('was', 'あいつ'))
    expect(editor.canUndo).toBe(false)
    expect(sourceOf(project, 'a').by).toBe('auto')
  })

  it('refuses an object somebody has locked', () => {
    const locked = standingOn('was', 'あいつ')
    const { project, editor } = openStanding([locked])
    project.blockById(PAGE, SOURCE_OF('a'))!.locked = true
    editor.cmdReplaceLabelSource(PAGE, SOURCE_OF('a'), reading('now', 'おいつ'))
    expect(sourceOf(project, 'a').lines.join('\n')).toBe('あいつ')
  })
})

describe('the translation candidates', () => {
  function withCandidates(...candidates: TranslationCandidate[]): TextLayerEntry {
    const entry = label('a', '自己打的')
    Object.assign(entry, { __pool: candidates })
    return entry
  }

  /** The pool belongs to the translation, so it is filled once the page exists. */
  function openPooled(labels: TextLayerEntry[]) {
    const opened = openOnePage(labels)
    for (const entry of labels) {
      const pool = (entry as unknown as { __pool?: TranslationCandidate[] }).__pool
      if (pool) opened.project.unitById(PAGE, entry.id)!.candidates = pool
    }
    return opened
  }

  const rowsOf = (project: ReturnType<typeof useProjectStore>) =>
    project.unitById(PAGE, 'a')!.candidates
  const chosenOf = (project: ReturnType<typeof useProjectStore>) =>
    project.unitById(PAGE, 'a')!.chosen

  /**
   * ⭐ The two doors are one door. Typing reaches whichever row the object is
   * reading, whether the caret is in the object on the canvas or in its list, so
   * the amulet lands either way — where it used to depend on which panel the
   * person happened to be looking at.
   */
  it('takes a proposal as your own the moment it is typed into, from either door', () => {
    const { project, editor } = openPooled([withCandidates({ id: 'm', pieces: [['模型的']] })])
    editor.cmdPickTranslation(PAGE, 'a', 'm')
    project.updateLabelText(PAGE, 'a', '我改的')
    expect(rowsOf(project)[0]).toMatchObject({ pieces: [['我改的']], human: true })
  })

  /** Or a model could no longer withdraw words it wrote and nobody kept. */
  it('hands an untouched proposal back to the model when the typing is undone', () => {
    const { project, editor } = openPooled([withCandidates({ id: 'm', pieces: [['模型的']] })])
    editor.cmdPickTranslation(PAGE, 'a', 'm')
    editor.beginTextEdit(PAGE, 'a', '模型的')
    project.updateLabelText(PAGE, 'a', '我改的')
    editor.commitTextEdit()
    editor.undo()
    expect(rowsOf(project)[0].pieces[0]).toEqual(['模型的'])
    expect(rowsOf(project)[0].human).toBeUndefined()
  })

  /** A proposal that was already somebody's stays theirs through an undo. */
  it('leaves a proposal that was already yours marked as yours', () => {
    const { project, editor } = openPooled([
      withCandidates({ id: 'h', pieces: [['我寫的']], human: true }),
    ])
    editor.cmdPickTranslation(PAGE, 'a', 'h')
    editor.beginTextEdit(PAGE, 'a', '我寫的')
    project.updateLabelText(PAGE, 'a', '再改一次')
    editor.commitTextEdit()
    editor.undo()
    expect(rowsOf(project)[0]).toMatchObject({ pieces: [['我寫的']], human: true })
  })

  /**
   * ⚠️ The decision the whole list exists to make. A Ctrl+Z that skipped past it
   * to take back the sentence before would undo the wrong thing at the one
   * moment somebody is sure what they just did.
   */
  it('takes a pick back', () => {
    const { project, editor } = openPooled([withCandidates({ id: 'm', pieces: [['模型的']] })])
    editor.cmdPickTranslation(PAGE, 'a', 'm')
    expect(chosenOf(project)).toBe('m')
    editor.undo()
    expect(chosenOf(project)).toBeNull()
  })

  it('has nothing to record for picking the row already being read', () => {
    const { editor } = openPooled([withCandidates({ id: 'm', pieces: [['模型的']] })])
    editor.cmdPickTranslation(PAGE, 'a', null)
    expect(editor.canUndo).toBe(false)
  })

  it('adds a candidate blank, yours, and already being read', () => {
    const { project, editor } = openPooled([withCandidates()])
    editor.cmdAddTranslationCandidate(PAGE, 'a', 'fresh')
    expect(rowsOf(project)).toEqual([{ id: 'fresh', pieces: [['']], human: true }])
    expect(chosenOf(project)).toBe('fresh')
  })

  /**
   * ⚠️ The same proposal and not a twin of it: the chosen slot names it by id,
   * so a redo that minted a fresh one would leave that slot pointing at nothing.
   */
  it('brings the same candidate back on redo', () => {
    const { project, editor } = openPooled([withCandidates({ id: 'm', pieces: [['模型的']] })])
    editor.cmdPickTranslation(PAGE, 'a', 'm')
    editor.cmdAddTranslationCandidate(PAGE, 'a', 'fresh')
    editor.undo()
    expect(rowsOf(project).map((c) => c.id)).toEqual(['m'])
    expect(chosenOf(project)).toBe('m')
    editor.redo()
    expect(rowsOf(project).map((c) => c.id)).toEqual(['m', 'fresh'])
    expect(chosenOf(project)).toBe('fresh')
  })

  /**
   * ⭐ Back to its own typed lines, not on to the next proposal. Those lines are
   * the last thing anybody chose for themselves; picking the next one along
   * would be the program making a choice out of a deletion that said nothing
   * about it.
   */
  it('drops the object back to its own lines when the proposal it was reading is thrown away', () => {
    const { project, editor } = openPooled([
      withCandidates({ id: 'm', pieces: [['模型的']] }, { id: 'n', pieces: [['另一個']] }),
    ])
    editor.cmdPickTranslation(PAGE, 'a', 'm')
    editor.cmdRemoveTranslation(PAGE, 'a', 'm')
    expect(chosenOf(project)).toBeNull()
    expect(textsOf(project)[0]).toBe('自己打的')
  })

  it('puts a thrown-away proposal back where it was, still being read', () => {
    const { project, editor } = openPooled([
      withCandidates(
        { id: 'first', pieces: [['一']] },
        { id: 'second', pieces: [['二']] },
        { id: 'third', pieces: [['三']] },
      ),
    ])
    editor.cmdPickTranslation(PAGE, 'a', 'second')
    editor.cmdRemoveTranslation(PAGE, 'a', 'second')
    editor.undo()
    expect(rowsOf(project).map((c) => c.id)).toEqual(['first', 'second', 'third'])
    expect(chosenOf(project)).toBe('second')
  })

  it('leaves the row being read alone when some other proposal is thrown away', () => {
    const { project, editor } = openPooled([
      withCandidates({ id: 'm', pieces: [['模型的']] }, { id: 'n', pieces: [['另一個']] }),
    ])
    editor.cmdPickTranslation(PAGE, 'a', 'm')
    editor.cmdRemoveTranslation(PAGE, 'a', 'n')
    expect(chosenOf(project)).toBe('m')
  })

  it('refuses every one of them on a locked object', () => {
    const locked = withCandidates({ id: 'm', pieces: [['模型的']] })
    locked.locked = true
    const { project, editor } = openPooled([locked])
    editor.cmdPickTranslation(PAGE, 'a', 'm')
    editor.cmdAddTranslationCandidate(PAGE, 'a', 'fresh')
    editor.cmdRemoveTranslation(PAGE, 'a', 'm')
    expect(chosenOf(project)).toBeNull()
    expect(rowsOf(project).map((c) => c.id)).toEqual(['m'])
  })
})

/**
 * ⭐ What arrives is a square root or a regression head — fifteen significant
 * digits of precision it does not have. The statistics that ask "what size does
 * this kind of line use" bucket by exact equality, so unrounded every object
 * landed in a bucket of its own and every recommendation was a count of one.
 */
describe('a style set the way a run measured the artwork', () => {
  const reading = { hash: 'h1', text: 'ふん' }

  it('rounds the measured size and leading to whole numbers', () => {
    const { project, editor } = openOnePage()
    editor.cmdAddLabelFromReading(PAGE, { x: 100, y: 100 }, reading, {
      vertical: true,
      fontSizePx: 27.712812921102035,
      leadingPercent: 118.40000152587891,
    })
    const { style } = labelsOf(project)[0].body
    expect(style.fontSizePx).toBe(28)
    expect(style.leadingPercent).toBe(118)
  })

  /** Two balloons a hair apart are one size, which is the whole point. */
  it('lands two nearly equal measurements on the same value', () => {
    const { project, editor } = openOnePage()
    editor.cmdAddLabelFromReading(PAGE, { x: 100, y: 100 }, { hash: 'a', text: '一' }, {
      fontSizePx: 27.6,
    })
    editor.cmdAddLabelFromReading(PAGE, { x: 300, y: 100 }, { hash: 'b', text: '二' }, {
      fontSizePx: 28.4,
    })
    expect(labelsOf(project).map((l) => l.body.style.fontSizePx)).toEqual([28, 28])
  })

  /** ⚠️ Absent still means unmeasured, and keeps whatever it is laid over. */
  it('leaves a field the run did not measure alone', () => {
    const { project, editor } = openOnePage()
    const seed = project.header.seedStyle
    editor.cmdAddLabelFromReading(PAGE, { x: 100, y: 100 }, reading, {})
    const { style } = labelsOf(project)[0].body
    expect(style.fontSizePx).toBe(seed.fontSizePx)
    expect(style.leadingPercent).toBe(seed.leadingPercent)
  })

  /**
   * ⚠️ A leading is a share of the type size, so it is the one measurement that
   * still means what it meant at a size the balloon never used.
   */
  it('keeps the measured leading on a source object re-set at the page size', () => {
    const { project, editor } = openOnePage()
    editor.cmdAddLabelFromReading(PAGE, { x: 100, y: 100 }, reading, {
      vertical: true,
      fontSizePx: 38,
      leadingPercent: 118,
    })
    expect(labelsOf(project)[0].body.style).toMatchObject({
      direction: 'vertical',
      leadingPercent: 118,
    })
  })
})

/**
 * ⭐ The source side is read against the artwork underneath it. Set the way the
 * artwork is set, it covers the very thing it is being checked against.
 */
describe('the one size the source side is read at', () => {
  const reading = { hash: 'h1', text: 'ふん' }

  /** A fiftieth of the short edge of the scan opened below. */
  const READING_SIZE_PX = 86

  /**
   * ⚠️ A scan rather than the 1200px page the rest of these tests open. A
   * fiftieth of 1200 is the seed size itself, so every expectation here would
   * hold just as well against a derivation that had stopped working and fallen
   * back to the seed.
   */
  function openScan(labels: TextLayerEntry[] = []) {
    const opened = openOnePage(labels)
    opened.project.allFiles[0].page.width = 4299
    opened.project.allFiles[0].page.height = 6071
    return opened
  }

  it('sets a dropped reading at the page size rather than at the measured one', () => {
    const { project, editor } = openScan()
    editor.cmdAddLabelFromReading(PAGE, { x: 100, y: 100 }, reading, { fontSizePx: 38 })
    expect(sourceOf(project, labelsOf(project)[0].id).style.fontSizePx).toBe(READING_SIZE_PX)
  })

  it('sets a born object at it too, however the balloon was measured', () => {
    const { project, editor } = openScan()
    editor.cmdApplyVerdict(PAGE, {
      fills: new Map(),
      spawns: [
        { from: 'r1', text: 'いち', centre: { x: 300, y: 400 }, fontSizePx: 38 },
        { from: 'r2', text: 'に', centre: { x: 600, y: 400 }, fontSizePx: 72 },
      ],
    })
    expect(labelsOf(project).map((l) => sourceOf(project, l.id).style.fontSizePx)).toEqual([
      READING_SIZE_PX,
      READING_SIZE_PX,
    ])
  })

  /** Correcting what an object says is not an occasion to re-size its source. */
  it('holds a standing object at it when a run fills it', () => {
    const { project, editor } = openScan([label('a')])
    editor.cmdApplyVerdict(PAGE, {
      fills: new Map([[SOURCE_OF('a'), { text: 'ふん', from: 'r1', fontSizePx: 38 }]]),
      spawns: [],
    })
    expect(sourceOf(project, labelsOf(project)[0].id).style.fontSizePx).toBe(READING_SIZE_PX)
  })
})

/**
 * The head that answers leading reads the gap between two lines, and a region
 * holding one line has no gap to read — what comes back there is invented.
 */
describe('a measured leading out of the range a page can be set in', () => {
  const reading = { hash: 'h1', text: 'ふん' }

  it('refuses to stack the lines through each other', () => {
    const { project, editor } = openOnePage()
    editor.cmdAddLabelFromReading(PAGE, { x: 100, y: 100 }, reading, { leadingPercent: 41 })
    expect(labelsOf(project)[0].body.style.leadingPercent).toBe(100)
  })

  it('refuses to blow the lines apart', () => {
    const { project, editor } = openOnePage()
    editor.cmdAddLabelFromReading(PAGE, { x: 100, y: 100 }, reading, { leadingPercent: 900 })
    expect(labelsOf(project)[0].body.style.leadingPercent).toBe(250)
  })
})
