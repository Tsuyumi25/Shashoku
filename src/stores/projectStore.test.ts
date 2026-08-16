import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useProjectStore } from './projectStore'
import { defaultManifest, serializeManifest } from '@shared/page/schema'
import { defaultProjectJson, serializeProjectJson } from '@shared/project/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { TextLayerEntry } from '@shared/page/types'

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
        badge: 'ok',
      },
      {
        pageId: damagedId,
        pageDir: `${ROOT}/shashoku/pages/${damagedId}`,
        page: defaultManifest(damagedId, 1, 1),
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
