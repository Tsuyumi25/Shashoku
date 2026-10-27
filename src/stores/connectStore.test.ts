import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConnectStore } from './connectStore'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'
import type { TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { OCR_SCHEMA_VERSION } from '@shared/page/types'
import { blankBlock } from '@shared/page/schema'

const PAGE = 'p001.png'
const AT = { x: 0, y: 0 }

function label(id: string): TextLayerEntry {
  return {
    ...blankBlock(id, 'translation', DEFAULT_TEXT_STYLE),
  }
}

function openPage(ids: string[]) {
  const project = useProjectStore()
  project.allFiles = [
    {
      pageId: PAGE,
      pageDir: `/x/${PAGE}`,
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        name: 'p',
        width: 1200,
        height: 1700,
        // A unit's id is never its block's: the lines join units, and a press
        // lands on a block.
        translationUnits: ids.map((id) => ({
          id: `u-${id}`,
          tags: [],
          source: { members: [], separators: [] },
          translation: { members: [id], separators: [] },
          candidates: [],
          chosen: null,
        })),
        readingOrder: ids.map((id) => `u-${id}`),
        readingEdges: [],
        layers: ids.map(label),
      },
      ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
      badge: 'ok',
    },
  ]
  const editor = useEditorStore()
  editor.currentPageId = PAGE
  return { project, editor, connect: useConnectStore() }
}

const edgesOf = (project: ReturnType<typeof useProjectStore>) =>
  project.pageById(PAGE)?.page.readingEdges ?? []

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('a chain being drawn', () => {
  it('writes nothing to the page while it is under way', () => {
    const { project, connect } = openPage(['a', 'b'])
    connect.begin(PAGE, 'u-a', AT)
    connect.reach('u-b')
    expect(edgesOf(project)).toEqual([])
    expect(connect.links).toEqual([{ from: 'u-a', to: 'u-b' }])
  })

  it('lands the whole chain on the page in one act', () => {
    const { project, editor, connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'u-a', AT)
    connect.reach('u-b')
    connect.reach('u-c')
    connect.commit()
    expect(edgesOf(project)).toHaveLength(2)
    editor.undo()
    expect(edgesOf(project)).toEqual([])
  })

  /**
   * Cancelling is free because the document was never touched — the same thing
   * that makes changing tool, turning the page and Escape all clean exits.
   */
  it('leaves nothing behind when it is cancelled', () => {
    const { project, editor, connect } = openPage(['a', 'b'])
    connect.begin(PAGE, 'u-a', AT)
    connect.reach('u-b')
    connect.cancel()
    expect(edgesOf(project)).toEqual([])
    expect(editor.canUndo).toBe(false)
    expect(connect.gesture).toBeNull()
  })

  it('carries on from wherever the last link landed', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'u-a', AT)
    connect.reach('u-b')
    expect(connect.gesture?.source).toBe('u-b')
    connect.reach('u-c')
    expect(connect.links).toEqual([
      { from: 'u-a', to: 'u-b' },
      { from: 'u-b', to: 'u-c' },
    ])
  })

  it('refuses a link that would close a ring against its own links', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'u-a', AT)
    connect.reach('u-b')
    connect.reach('u-c')
    expect(connect.refuses('u-a')).toBe(true)
    expect(connect.reach('u-a')).toBe(false)
    expect(connect.links).toHaveLength(2)
  })

  it('refuses a link that would close a ring against a line already on the page', () => {
    const { editor, connect } = openPage(['a', 'b'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'u-a', to: 'u-b' }])
    connect.begin(PAGE, 'u-b', AT)
    expect(connect.refuses('u-a')).toBe(true)
  })

  it('refuses an object pointed at itself', () => {
    const { connect } = openPage(['a'])
    connect.begin(PAGE, 'u-a', AT)
    expect(connect.refuses('u-a')).toBe(true)
  })

  it('refuses to reach a locked object, and to set out from one', () => {
    const { project, editor, connect } = openPage(['a', 'b'])
    const file = project.pageById(PAGE)
    if (!file) throw new Error('page missing')
    editor.cmdSetLayerLocked(PAGE, 'b', true)
    connect.begin(PAGE, 'u-a', AT)
    expect(connect.refuses('u-b')).toBe(true)
  })

  /**
   * Walking along a line already drawn is not a mistake to refuse — it is how
   * you carry on from the middle of a chain — so it moves the source on and
   * adds nothing.
   */
  it('walks along a line already there without drawing a second one', () => {
    const { editor, connect } = openPage(['a', 'b', 'c'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'u-a', to: 'u-b' }])
    connect.begin(PAGE, 'u-a', AT)
    expect(connect.refuses('u-b')).toBe(false)
    expect(connect.reach('u-b')).toBe(true)
    expect(connect.links).toEqual([])
    expect(connect.gesture?.source).toBe('u-b')
  })

  it('commits nothing for a chain that laid no links', () => {
    const { editor, connect } = openPage(['a', 'b'])
    connect.begin(PAGE, 'u-a', AT)
    connect.commit()
    expect(editor.canUndo).toBe(false)
    expect(connect.gesture).toBeNull()
  })
})

describe('taking a link back inside the chain', () => {
  it('takes the last one back and carries on from where it was', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'u-a', AT)
    connect.reach('u-b')
    connect.reach('u-c')
    expect(connect.gestureUndo()).toBe(true)
    expect(connect.links).toEqual([{ from: 'u-a', to: 'u-b' }])
    expect(connect.gesture?.source).toBe('u-b')
  })

  /**
   * Running out cancels the chain rather than reaching past it: an unfinished
   * chain is not in the document, so letting the key through would undo
   * whatever happened before it while the half-drawn chain sat there.
   */
  it('cancels the whole chain rather than reaching past it', () => {
    const { editor, connect } = openPage(['a', 'b'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'u-a', to: 'u-b' }])
    connect.begin(PAGE, 'u-b', AT)
    expect(connect.gestureUndo()).toBe(true)
    expect(connect.gesture).toBeNull()
    expect(editor.canUndo).toBe(true)
  })

  it('answers no when there is no chain to take anything back from', () => {
    const { connect } = openPage(['a'])
    expect(connect.gestureUndo()).toBe(false)
    expect(connect.gestureRedo()).toBe(false)
  })

  // Redo from the first day: half of it is worse than none.
  it('puts a link back that was taken back', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'u-a', AT)
    connect.reach('u-b')
    connect.reach('u-c')
    connect.gestureUndo()
    expect(connect.gestureRedo()).toBe(true)
    expect(connect.links).toHaveLength(2)
    expect(connect.gesture?.source).toBe('u-c')
  })

  it('forgets what it took back once a new link is laid', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'u-a', AT)
    connect.reach('u-b')
    connect.gestureUndo()
    connect.reach('u-c')
    connect.gestureRedo()
    expect(connect.links).toEqual([{ from: 'u-a', to: 'u-c' }])
  })
})

describe('the line being looked at', () => {
  it('rubs out the one chosen and gives it back', () => {
    const { project, editor, connect } = openPage(['a', 'b'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'u-a', to: 'u-b' }])
    connect.select(PAGE, { from: 'u-a', to: 'u-b' })
    expect(connect.eraseSelected()).toBe(true)
    expect(edgesOf(project)).toEqual([])
    editor.undo()
    expect(edgesOf(project)).toEqual([{ from: 'u-a', to: 'u-b' }])
  })

  it('says no when nothing is chosen, so the key falls through', () => {
    const { connect } = openPage(['a', 'b'])
    expect(connect.eraseSelected()).toBe(false)
  })
})

describe('lines touching a locked translation', () => {
  it('cannot be drawn by the command, even when the chain was laid before the lock', () => {
    const { project, editor } = openPage(['a', 'b'])
    editor.cmdSetLayerLocked(PAGE, 'b', true)

    editor.cmdDrawReadingEdges(PAGE, [{ from: 'u-a', to: 'u-b' }])

    expect(edgesOf(project)).toEqual([])
  })

  it('cannot be erased', () => {
    const { project, editor } = openPage(['a', 'b'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'u-a', to: 'u-b' }])
    editor.cmdSetLayerLocked(PAGE, 'a', true)

    editor.cmdEraseReadingEdges(PAGE, [{ from: 'u-a', to: 'u-b' }])

    expect(edgesOf(project)).toEqual([{ from: 'u-a', to: 'u-b' }])
  })
})
