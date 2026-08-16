import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
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
  project.files = [
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
    project.files = [
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
