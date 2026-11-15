import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLibraryPageOrder } from './useLibraryPageOrder'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'
import type { ProjectFile } from '@/types/project'
import { defaultProjectJson, serializeProjectJson } from '@shared/project/schema'
import type { ProjectJson } from '@shared/project/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import { emptyCounters } from '@shared/page/numbers'

const metaByRoot = new Map<string, ProjectJson>()
let pageCounter = 0
const scanByRoot = new Map<string, { hasShashokuDir: boolean; hasSentinel: boolean }>()
let created: string[] = []

function seed(root: string, pages: string[]): void {
  metaByRoot.set(root, { ...defaultProjectJson(), pages })
}

function metaOf(root: string): ProjectJson {
  return metaByRoot.get(root) ?? defaultProjectJson()
}

function stubWindow() {
  vi.stubGlobal('window', {
    api: {
      readProjectMeta: async (root: string) => serializeProjectJson(metaOf(root)),
      writeProjectMeta: async () => {},
      readPage: async () => ({ manifestRaw: '', ocrRaw: null }),
      createPage: async () => {
        pageCounter += 1
        return `p${pageCounter}`
      },
      scanRoot: async (root: string) =>
        scanByRoot.get(root) ?? { hasShashokuDir: false, hasSentinel: false },
      createProject: async (root: string) => {
        created.push(root)
        return { projectMetaRaw: serializeProjectJson(defaultProjectJson()), pages: [] }
      },
    },
  })
}

function pageOf(pageId: string): ProjectFile {
  return {
    pageId,
    pageDir: `/x/${pageId}`,
    ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 100, height: 100, candidates: [] },
    page: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: pageId,
      width: 100,
      height: 100,
      ledgers: {},
      readingOrder: [],
      readingEdges: [],
      counters: emptyCounters(),
      pageTree: [],
      faceTrees: {},
    },
    badge: 'ok',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  metaByRoot.clear()
  pageCounter = 0
  scanByRoot.clear()
  created = []
  stubWindow()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('importing files onto a book nobody has open', () => {
  it('creates one page per file and inserts the batch as one step', async () => {
    seed('/book-b', ['x'])
    const order = useLibraryPageOrder()
    const bookMeta = useBookMetaStore()

    await order.importFilesAt('/book-b', ['a.png', 'b.png'], 1)

    const handle = await bookMeta.handleFor('/book-b')
    expect(handle?.order).toEqual(['x', 'p1', 'p2'])
    expect(handle?.meta.deletedPages ?? []).toEqual([])
  })

  it('undoes by tombstoning, never by taking the name out of the order', async () => {
    seed('/book-b', ['x'])
    const order = useLibraryPageOrder()
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()

    await order.importFilesAt('/book-b', ['a.png'], 1)
    editor.undo('/book-b')

    const handle = await bookMeta.handleFor('/book-b')
    expect(handle?.order).toEqual(['x', 'p1'])
    expect(handle?.meta.deletedPages).toEqual(['p1'])

    editor.redo('/book-b')
    const after = await bookMeta.handleFor('/book-b')
    expect(after?.meta.deletedPages ?? []).toEqual([])
  })
})

describe('redoing an import', () => {
  /**
   * A redo lifts the tombstone and nothing else. Re-applying the order it was
   * imported under would speak for `q`, a page that landed afterwards and was
   * itself undone — and put it back where the first import's snapshot had a
   * slot going spare.
   */
  it('redoes an import by lifting its tombstone, not by replaying its order', async () => {
    seed('/book-d', ['x'])
    const order = useLibraryPageOrder()
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()

    await order.importFilesAt('/book-d', ['p.png'], 1)
    await order.importFilesAt('/book-d', ['q.png'], 2)
    editor.undo('/book-d') // q, tombstoned but still named
    editor.undo('/book-d') // p, likewise

    editor.redo('/book-d') // p again

    const handle = await bookMeta.handleFor('/book-d')
    expect(handle?.order).toEqual(['x', 'p1', 'p2'])
    expect(handle?.meta.deletedPages).toEqual(['p2'])
  })
})

describe('importing onto the book open in the editor', () => {
  it('reads the new page off disk and adds it to allFiles, tombstoning it on undo', async () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.rootPath = '/open-book-2'
    project.allFiles = [pageOf('a')]

    const order = useLibraryPageOrder()
    await order.importFilesAt('/open-book-2', ['new.png'], 1)

    expect(project.allFiles.map((f) => f.pageId)).toEqual(['a', 'p1'])

    editor.undo()
    expect(project.allFiles.map((f) => f.pageId)).toEqual(['a', 'p1'])
    expect(project.projectMeta.deletedPages).toEqual(['p1'])
  })
})

/**
 * Nothing the user has already given up may vanish quietly. Each of these is a
 * write that failed somewhere the failure used to be swallowed whole.
 */
describe('a write that did not land', () => {
  it('settles the pages a half-failed batch did make, and says the rest did not', async () => {
    seed('/book-e', ['x'])
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()
    let made = 0
    vi.stubGlobal('window', {
      api: {
        ...window.api,
        createPage: async () => {
          made += 1
          if (made === 2) throw new Error('no space left on device')
          return `p${made}`
        },
      },
    })

    await useLibraryPageOrder().importFilesAt('/book-e', ['a.png', 'b.png', 'c.png'], 1)

    // The one page that was made is in the chapter, at the drop point, and on
    // the stack — not left on disk for a later open to adopt at the end.
    const handle = await bookMeta.handleFor('/book-e')
    expect(handle?.order).toEqual(['x', 'p1'])
    expect(useNoticeStore().notice?.text).toContain('1')

    editor.undo('/book-e')
    expect((await bookMeta.handleFor('/book-e'))?.meta.deletedPages).toEqual(['p1'])
  })

  it('says so when the first file of a batch could not be made at all', async () => {
    seed('/book-f', ['x'])
    vi.stubGlobal('window', {
      api: {
        ...window.api,
        createPage: async () => {
          throw new Error('no space left on device')
        },
      },
    })

    await useLibraryPageOrder().importFilesAt('/book-f', ['a.png'], 1)

    expect((await useBookMetaStore().handleFor('/book-f'))?.order).toEqual(['x'])
    expect(useNoticeStore().notice?.text).toBeTruthy()
  })

})

describe('a drop that has to make the project first', () => {
  it('builds one in a folder that holds nothing of ours, then imports', async () => {
    await useLibraryPageOrder().importFilesAt('/fresh', ['a.png'], 0, true)

    expect(created).toEqual(['/fresh'])
    expect((await useBookMetaStore().handleFor('/fresh'))?.order).toEqual(['p1'])
  })

  it('leaves a folder that already carries the sentinel alone', async () => {
    seed('/already', ['x'])
    scanByRoot.set('/already', { hasShashokuDir: true, hasSentinel: true })

    await useLibraryPageOrder().importFilesAt('/already', ['a.png'], 1, true)

    expect(created).toEqual([])
    expect((await useBookMetaStore().handleFor('/already'))?.order).toEqual(['x', 'p1'])
  })

  /**
   * `createProject` writes a default `project.json` over whatever is there,
   * so a missing sentinel beside a `shashoku/` full of work has to stop the
   * drop rather than be read as an empty folder.
   */
  it('refuses a shashoku folder whose sentinel is gone, and says so', async () => {
    scanByRoot.set('/wounded', { hasShashokuDir: true, hasSentinel: false })

    await useLibraryPageOrder().importFilesAt('/wounded', ['a.png'], 0, true)

    expect(created).toEqual([])
    expect(pageCounter).toBe(0)
    expect(useNoticeStore().notice?.text).toBeTruthy()
  })
})
