import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'
import { defaultManifest, defaultOcr, serializeManifest } from '@shared/page/schema'
import { defaultProjectJson, serializeProjectJson } from '@shared/project/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { TextLayerEntry } from '@shared/page/types'
import { textOf } from '@shared/page/text'

const ROOT = '/root'
const PAGE_ID = 'source-260809-1200'
const PAGE_DIR = `${ROOT}/shashoku/pages/${PAGE_ID}`

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
    lines: ['x'],
    source: { hash: null, by: 'auto' },
    ownSource: '',
    translations: [],
    translation: null,
    style: { ...DEFAULT_TEXT_STYLE },
  }
}

/**
 * What the main process was asked to do, in the order it was asked, plus what
 * the store still owed to disk at the moment the sweep ran.
 */
interface Trace {
  calls: string[]
  oweAtSweep: boolean | null
}

function stubApi(project: ReturnType<typeof useProjectStore>): Trace {
  const trace: Trace = { calls: [], oweAtSweep: null }
  vi.stubGlobal('window', {
    api: {
      createPage: async () => {
        trace.calls.push('createPage')
        return 'made-260809-1201'
      },
      writePage: async () => {
        trace.calls.push('writePage')
      },
      writeProjectMeta: async () => {
        trace.calls.push('writeProjectMeta')
      },
      writePreferences: async () => {},
      openProject: async () => {
        trace.calls.push('openProject')
        trace.oweAtSweep = project.dirty
        return { projectMetaRaw: serializeProjectJson(defaultProjectJson()), pages: [] }
      },
      readPage: async () => ({ manifestRaw: serializeManifest(defaultManifest('p', 100, 100)) }),
      scanRoot: async () => ({ rootImages: [], hasShashokuDir: true, hasSentinel: true }),
    },
  })
  return trace
}

function openOnePage(project: ReturnType<typeof useProjectStore>) {
  project.rootPath = ROOT
  project.allFiles = [
    {
      pageId: PAGE_ID,
      pageDir: PAGE_DIR,
      page: defaultManifest('source', 1200, 1700),
      ocr: defaultOcr(1200, 1700),
      badge: 'ok',
    },
  ]
}

describe('reading a project back off disk', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The sweep on the other side of openProject deletes every layer file the
  // manifest on disk does not name, and a tool writes its pixels long before
  // the manifest naming them leaves the autosave queue. Reversing these two is
  // not a slow save, it is deleted work — so the order is what gets pinned
  // here rather than any one function's behaviour.
  it('owes nothing to disk by the time the sweep runs', async () => {
    const project = useProjectStore()
    openOnePage(project)
    const trace = stubApi(project)

    project.addLabel(PAGE_ID, label('t1'))
    expect(project.dirty).toBe(true)

    await project.createPages(['a.jpg'])

    expect(trace.oweAtSweep).toBe(false)
    expect(trace.calls.indexOf('writePage')).toBeLessThan(trace.calls.indexOf('openProject'))
  })

  it('banks the outgoing project before opening another one', async () => {
    const project = useProjectStore()
    openOnePage(project)
    const trace = stubApi(project)

    project.addLabel(PAGE_ID, label('t2'))

    await project.openByPath('/elsewhere')

    expect(trace.oweAtSweep).toBe(false)
    expect(trace.calls.indexOf('writePage')).toBeLessThan(trace.calls.indexOf('openProject'))
  })
})

describe('the translation pool on an object', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function withLabel() {
    const project = useProjectStore()
    openOnePage(project)
    project.addLabel(PAGE_ID, label('t1'))
    return project
  }

  it('leaves the typed lines alone when a candidate is taken', () => {
    const project = withLabel()
    const id = project.addTranslation(PAGE_ID, 't1', ['候選'], 'model')!
    project.setLabelTranslation(PAGE_ID, 't1', id)

    expect(textOf(project.labelById(PAGE_ID, 't1')!)).toBe('候選')
    expect(project.labelById(PAGE_ID, 't1')!.lines).toEqual(['x'])
  })

  it('brings the typed lines back word for word when the slot is emptied', () => {
    const project = withLabel()
    const id = project.addTranslation(PAGE_ID, 't1', ['候選'], 'model')!
    project.setLabelTranslation(PAGE_ID, 't1', id)
    project.setLabelTranslation(PAGE_ID, 't1', null)

    expect(textOf(project.labelById(PAGE_ID, 't1')!)).toBe('x')
  })

  /**
   * Typing goes where the object is reading from, or it lands somewhere nobody
   * can see — which is the one way this arrangement could lose somebody's work.
   */
  it('types into whichever candidate the object is reading', () => {
    const project = withLabel()
    const id = project.addTranslation(PAGE_ID, 't1', ['候選'], 'model')!
    project.setLabelTranslation(PAGE_ID, 't1', id)
    project.updateLabelText(PAGE_ID, 't1', '改過的')

    const label1 = project.labelById(PAGE_ID, 't1')!
    expect(label1.translations[0].lines).toEqual(['改過的'])
    expect(label1.lines).toEqual(['x'])
  })

  it('types into the object itself when the slot is empty', () => {
    const project = withLabel()
    project.addTranslation(PAGE_ID, 't1', ['候選'], 'model')
    project.updateLabelText(PAGE_ID, 't1', '改過的')

    const label1 = project.labelById(PAGE_ID, 't1')!
    expect(label1.lines).toEqual(['改過的'])
    expect(label1.translations[0].lines).toEqual(['候選'])
  })

  it('falls back to the typed lines when what it was reading is thrown away', () => {
    const project = withLabel()
    const id = project.addTranslation(PAGE_ID, 't1', ['候選'], 'model')!
    project.setLabelTranslation(PAGE_ID, 't1', id)
    project.removeTranslation(PAGE_ID, 't1', id)

    const label1 = project.labelById(PAGE_ID, 't1')!
    expect(label1.translation).toBeNull()
    expect(textOf(label1)).toBe('x')
  })

  it('reorders the pool without touching what is in the slot', () => {
    const project = withLabel()
    const first = project.addTranslation(PAGE_ID, 't1', ['一'], 'model')!
    project.addTranslation(PAGE_ID, 't1', ['二'], 'model')
    project.setLabelTranslation(PAGE_ID, 't1', first)
    project.moveTranslation(PAGE_ID, 't1', 0, 1)

    const label1 = project.labelById(PAGE_ID, 't1')!
    expect(label1.translations.map((c) => c.lines[0])).toEqual(['二', '一'])
    expect(label1.translation).toBe(first)
    expect(textOf(label1)).toBe('一')
  })

  it('makes a proposal yours the moment you type over it', () => {
    const project = withLabel()
    const id = project.addTranslation(PAGE_ID, 't1', ['模型的'], 'model')!
    project.correctTranslation(PAGE_ID, 't1', id, '我改的')

    expect(project.labelById(PAGE_ID, 't1')!.translations[0]).toMatchObject({
      lines: ['我改的'],
      human: true,
    })
  })

  it('marks only what a person wrote', () => {
    const project = withLabel()
    project.addTranslation(PAGE_ID, 't1', ['模型的'], 'model')
    project.addTranslation(PAGE_ID, 't1', ['人的'], 'human')

    const { translations } = project.labelById(PAGE_ID, 't1')!
    expect(translations[0].human).toBeUndefined()
    expect(translations[1].human).toBe(true)
  })
})

/**
 * Deleting is a label stuck on, not a page taken away, so what is checked here
 * is what a chapter looks like afterwards — which pages it still has, in what
 * order — rather than which field was written.
 */
describe('deleting pages', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('window', {
      api: {
        writeProjectMeta: async () => {},
        writePreferences: async () => {},
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function openPages(count: number) {
    const project = useProjectStore()
    project.rootPath = ROOT
    project.allFiles = Array.from({ length: count }, (_, i) => {
      const pageId = `p${i}`
      return {
        pageId,
        pageDir: `${ROOT}/shashoku/pages/${pageId}`,
        page: defaultManifest(pageId, 1200, 1700),
        ocr: defaultOcr(1200, 1700),
        badge: 'ok' as const,
      }
    })
    return { project, editor: useEditorStore() }
  }

  const order = (project: ReturnType<typeof useProjectStore>) =>
    project.files.map((f) => f.pageId)

  it('takes the pages out of the chapter', () => {
    const { project, editor } = openPages(8)
    editor.cmdDeletePages(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(order(project)).toEqual(['p0', 'p6', 'p7'])
    expect(project.projectMeta.deletedPages).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  /**
   * Back where they were, not on the end. The pages never left the order in the
   * first place, which is the whole of why this works.
   */
  it('gives them all back in their own places', () => {
    const { project, editor } = openPages(8)
    const before = order(project)
    editor.cmdDeletePages(['p1', 'p2', 'p3', 'p4', 'p5'])
    editor.undo()
    expect(order(project)).toEqual(before)
  })

  it('deletes them again on redo', () => {
    const { project, editor } = openPages(8)
    editor.cmdDeletePages(['p1', 'p2', 'p3', 'p4', 'p5'])
    editor.undo()
    editor.redo()
    expect(order(project)).toEqual(['p0', 'p6', 'p7'])
  })

  /**
   * One act by the hand, one Ctrl+Z. The stack is bounded, so a page each would
   * let deleting a chapter push the session's work off the bottom of it.
   */
  it('costs one step of history however many pages went', () => {
    const { editor } = openPages(8)
    editor.cmdDeletePages(['p1', 'p2', 'p3', 'p4', 'p5'])
    editor.undo()
    expect(editor.canUndo).toBe(false)
  })

  /**
   * What an undo takes back is what happened, so a page the batch could not
   * touch must not come back out of one.
   */
  it('carries only the pages it really marked', () => {
    const { project, editor } = openPages(4)
    project.tagPagesDeleted(['p0'])
    editor.cmdDeletePages(['p0', 'p1', 'nobody'])

    expect(order(project)).toEqual(['p2', 'p3'])
    editor.undo()
    expect(order(project)).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('saving', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // A page whose manifest could not be read opens as a blank stand-in. Writing
  // that stand-in back would replace a file that may still be recoverable, so
  // the save must leave it untouched however the page came to be marked dirty.
  it('never writes a page that opened as a stand-in', async () => {
    const project = useProjectStore()
    const damagedId = 'source-260809-1300'
    project.rootPath = ROOT
    project.allFiles = [
      {
        pageId: PAGE_ID,
        pageDir: PAGE_DIR,
        page: defaultManifest('source', 1200, 1700),
        ocr: defaultOcr(1200, 1700),
        badge: 'ok',
      },
      {
        pageId: damagedId,
        pageDir: `${ROOT}/shashoku/pages/${damagedId}`,
        page: defaultManifest(damagedId, 1, 1),
        ocr: defaultOcr(1, 1),
        badge: 'damaged',
      },
    ]
    const written: string[] = []
    vi.stubGlobal('window', {
      api: {
        writePage: async (pageDir: string) => {
          written.push(pageDir)
        },
        writePreferences: async () => {},
      },
    })

    project.addLabel(PAGE_ID, label('t3'))
    project.addLabel(damagedId, label('t4'))
    await project.flush()

    expect(written).toEqual([PAGE_DIR])
  })
})

/**
 * Pixels are written on a scheduler of their own and much more slowly than the
 * manifest, so anything that reads `layers/` has to make it true first. A
 * register rather than a call from each of them, so a consumer added later
 * inherits the obligation instead of having to be told about it.
 */
describe('what is owed to the layers folder before anyone reads it', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function traceFlush() {
    const project = useProjectStore()
    openOnePage(project)
    const order: string[] = []
    vi.stubGlobal('window', {
      api: {
        writePage: async () => {
          order.push('manifest')
        },
        writeProjectMeta: async () => {},
        writePreferences: async () => {},
      },
    })
    project.oweBeforeLayerRead(async () => {
      order.push('pixels')
    })
    return { project, order }
  }

  // Settling the pixels is what gives the manifest its final layer names, so it
  // has to happen before the manifest goes down rather than beside it.
  it('settles the pixels before the manifest', async () => {
    const { project, order } = traceFlush()
    project.addLabel(PAGE_ID, label('t5'))

    await project.flush()

    expect(order).toEqual(['pixels', 'manifest'])
  })

  // The pixel flush calls this once it has named its file, so it must not turn
  // round and ask the pixels to settle again.
  it('leaves the obligations alone when only the manifest is asked for', async () => {
    const { project, order } = traceFlush()
    project.addLabel(PAGE_ID, label('t6'))

    await project.flushManifest()

    expect(order).toEqual(['manifest'])
  })

  it('still settles them when the manifest has nothing to write', async () => {
    const { project, order } = traceFlush()

    await project.flush()

    expect(order).toEqual(['pixels'])
  })
})
