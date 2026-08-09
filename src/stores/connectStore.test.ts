import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useConnectStore } from './connectStore'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'
import type { TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'

const PAGE = 'p001.png'
const AT = { x: 0, y: 0 }

function label(id: string): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    tags: [],
    rotation: 0,
    lines: [''],
    style: { ...DEFAULT_TEXT_STYLE },
  }
}

function openPage(ids: string[]) {
  const project = useProjectStore()
  project.files = [
    {
      pageId: PAGE,
      pageDir: `/x/${PAGE}`,
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        readingOrder: ids,
        readingEdges: [],
        layers: ids.map(label),
      },
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
    connect.begin(PAGE, 'a', AT)
    connect.reach('b')
    expect(edgesOf(project)).toEqual([])
    expect(connect.links).toEqual([{ from: 'a', to: 'b' }])
  })

  it('lands the whole chain on the page in one act', () => {
    const { project, editor, connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'a', AT)
    connect.reach('b')
    connect.reach('c')
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
    connect.begin(PAGE, 'a', AT)
    connect.reach('b')
    connect.cancel()
    expect(edgesOf(project)).toEqual([])
    expect(editor.canUndo).toBe(false)
    expect(connect.gesture).toBeNull()
  })

  it('carries on from wherever the last link landed', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'a', AT)
    connect.reach('b')
    expect(connect.gesture?.source).toBe('b')
    connect.reach('c')
    expect(connect.links).toEqual([
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ])
  })

  it('refuses a link that would close a ring against its own links', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'a', AT)
    connect.reach('b')
    connect.reach('c')
    expect(connect.refuses('a')).toBe(true)
    expect(connect.reach('a')).toBe(false)
    expect(connect.links).toHaveLength(2)
  })

  it('refuses a link that would close a ring against a line already on the page', () => {
    const { editor, connect } = openPage(['a', 'b'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    connect.begin(PAGE, 'b', AT)
    expect(connect.refuses('a')).toBe(true)
  })

  it('refuses an object pointed at itself', () => {
    const { connect } = openPage(['a'])
    connect.begin(PAGE, 'a', AT)
    expect(connect.refuses('a')).toBe(true)
  })

  it('refuses to reach a locked object, and to set out from one', () => {
    const { project, editor, connect } = openPage(['a', 'b'])
    const file = project.pageById(PAGE)
    if (!file) throw new Error('page missing')
    editor.cmdSetLayerLocked(PAGE, 'b', true)
    connect.begin(PAGE, 'a', AT)
    expect(connect.refuses('b')).toBe(true)
  })

  /**
   * Walking along a line already drawn is not a mistake to refuse — it is how
   * you carry on from the middle of a chain — so it moves the source on and
   * adds nothing.
   */
  it('walks along a line already there without drawing a second one', () => {
    const { editor, connect } = openPage(['a', 'b', 'c'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    connect.begin(PAGE, 'a', AT)
    expect(connect.refuses('b')).toBe(false)
    expect(connect.reach('b')).toBe(true)
    expect(connect.links).toEqual([])
    expect(connect.gesture?.source).toBe('b')
  })

  it('commits nothing for a chain that laid no links', () => {
    const { editor, connect } = openPage(['a', 'b'])
    connect.begin(PAGE, 'a', AT)
    connect.commit()
    expect(editor.canUndo).toBe(false)
    expect(connect.gesture).toBeNull()
  })
})

describe('taking a link back inside the chain', () => {
  it('takes the last one back and carries on from where it was', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'a', AT)
    connect.reach('b')
    connect.reach('c')
    expect(connect.gestureUndo()).toBe(true)
    expect(connect.links).toEqual([{ from: 'a', to: 'b' }])
    expect(connect.gesture?.source).toBe('b')
  })

  /**
   * Running out cancels the chain rather than reaching past it: an unfinished
   * chain is not in the document, so letting the key through would undo
   * whatever happened before it while the half-drawn chain sat there.
   */
  it('cancels the whole chain rather than reaching past it', () => {
    const { editor, connect } = openPage(['a', 'b'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    connect.begin(PAGE, 'b', AT)
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
    connect.begin(PAGE, 'a', AT)
    connect.reach('b')
    connect.reach('c')
    connect.gestureUndo()
    expect(connect.gestureRedo()).toBe(true)
    expect(connect.links).toHaveLength(2)
    expect(connect.gesture?.source).toBe('c')
  })

  it('forgets what it took back once a new link is laid', () => {
    const { connect } = openPage(['a', 'b', 'c'])
    connect.begin(PAGE, 'a', AT)
    connect.reach('b')
    connect.gestureUndo()
    connect.reach('c')
    connect.gestureRedo()
    expect(connect.links).toEqual([{ from: 'a', to: 'c' }])
  })
})

describe('the line being looked at', () => {
  it('rubs out the one chosen and gives it back', () => {
    const { project, editor, connect } = openPage(['a', 'b'])
    editor.cmdDrawReadingEdges(PAGE, [{ from: 'a', to: 'b' }])
    connect.select(PAGE, { from: 'a', to: 'b' })
    expect(connect.eraseSelected()).toBe(true)
    expect(edgesOf(project)).toEqual([])
    editor.undo()
    expect(edgesOf(project)).toEqual([{ from: 'a', to: 'b' }])
  })

  it('says no when nothing is chosen, so the key falls through', () => {
    const { connect } = openPage(['a', 'b'])
    expect(connect.eraseSelected()).toBe(false)
  })
})
