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

const metaByRoot = new Map<string, ProjectJson>()
let pageCounter = 0

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
      readingOrder: [],
      readingEdges: [],
      layers: [],
    },
    badge: 'ok',
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  metaByRoot.clear()
  pageCounter = 0
  stubWindow()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reordering a book nobody has open', () => {
  it('moves a whole batch in one step, and undo restores the exact order it replaced', async () => {
    seed('/book-a', ['a', 'b', 'c', 'd'])
    const order = useLibraryPageOrder()
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()

    await order.reorderPagesTo('/book-a', ['b', 'd'], 0)
    expect((await bookMeta.handleFor('/book-a'))?.order).toEqual(['b', 'd', 'a', 'c'])

    editor.undo('/book-a')
    expect((await bookMeta.handleFor('/book-a'))?.order).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not land in whichever book happens to be open in the editor', async () => {
    seed('/book-a', ['a', 'b'])
    const order = useLibraryPageOrder()
    const project = useProjectStore()
    const editor = useEditorStore()

    // Nothing open at all while the shelf reorders a book.
    expect(project.rootPath).toBeNull()
    await order.reorderPagesTo('/book-a', ['a'], 2)

    // The book the editor would undo by default has no such command.
    expect(editor.canUndo).toBe(false)
  })
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

/**
 * `[a,b] → [b,a] → import p → undo the import → undo the reorder`. The last
 * step applies a snapshot taken before `p` existed, and `p` is tombstoned by
 * then but still named in `pages`. Both writers have to reach the same answer:
 * the pages the snapshot covers go back, `p` holds the slot it landed in.
 */
describe('undoing a reorder that an import has since widened', () => {
  it('leaves the tombstoned import in its own slot, on a book nobody has open', async () => {
    seed('/book-c', ['a', 'b'])
    const order = useLibraryPageOrder()
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()

    await order.reorderPagesTo('/book-c', ['b'], 0)
    await order.importFilesAt('/book-c', ['p.png'], 1)
    expect((await bookMeta.handleFor('/book-c'))?.order).toEqual(['b', 'p1', 'a'])

    editor.undo('/book-c') // the import
    editor.undo('/book-c') // the reorder

    const handle = await bookMeta.handleFor('/book-c')
    expect(handle?.order).toEqual(['a', 'p1', 'b'])
    expect(handle?.meta.deletedPages).toEqual(['p1'])
  })

  it('reaches the same order on the book the editor has open', async () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.rootPath = '/open-book-3'
    project.allFiles = [pageOf('a'), pageOf('b')]

    const order = useLibraryPageOrder()
    await order.reorderPagesTo('/open-book-3', ['b'], 0)
    await order.importFilesAt('/open-book-3', ['p.png'], 1)
    expect(project.allFiles.map((f) => f.pageId)).toEqual(['b', 'p1', 'a'])

    editor.undo()
    editor.undo()

    expect(project.allFiles.map((f) => f.pageId)).toEqual(['a', 'p1', 'b'])
    expect(project.projectMeta.deletedPages).toEqual(['p1'])
  })

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

describe('the same gestures on the book open in the editor', () => {
  it('reorders projectStore.allFiles instead of a book-meta session, and undoes through the editor', async () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.rootPath = '/open-book'
    project.allFiles = [pageOf('a'), pageOf('b'), pageOf('c')]

    const order = useLibraryPageOrder()
    await order.reorderPagesTo('/open-book', ['a'], 2)
    expect(project.allFiles.map((f) => f.pageId)).toEqual(['b', 'c', 'a'])
    expect(editor.canUndo).toBe(true)

    editor.undo()
    expect(project.allFiles.map((f) => f.pageId)).toEqual(['a', 'b', 'c'])
  })

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

  /**
   * The shelf lets go of the promise these return, so a rejection would reach
   * nobody at all. The reorder itself stands; what is said is that the disk
   * does not have it yet.
   */
  it('tells the user when the order changed but the write did not land', async () => {
    seed('/book-g', ['a', 'b'])
    vi.stubGlobal('window', {
      api: {
        ...window.api,
        writeProjectMeta: async () => {
          throw new Error('read-only file system')
        },
      },
    })

    await expect(
      useLibraryPageOrder().reorderPagesTo('/book-g', ['b'], 0),
    ).resolves.toBeUndefined()

    expect(useNoticeStore().notice?.text).toBeTruthy()
  })
})
