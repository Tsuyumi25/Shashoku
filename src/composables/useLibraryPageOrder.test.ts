import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLibraryPageOrder } from './useLibraryPageOrder'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useEditorStore } from '@/stores/editorStore'
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
