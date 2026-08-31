import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useOpenProject } from './useOpenProject'
import { useLibraryPageOrder } from './useLibraryPageOrder'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { defaultProjectJson, parseProjectJson, serializeProjectJson } from '@shared/project/schema'
import { SHASHOKU_DIR } from '@shared/ssk/constants'

/**
 * One `project.json` per book, written and read back the way the two writers
 * both really reach it — the shelf through `writeProjectMeta`, an open through
 * `openProject`. A handover that lets the lightweight writer land after the
 * open has read shows up here as an order the editor never saw.
 */
const disk = new Map<string, string[]>()

function rootOfShashokuDir(dir: string): string {
  return dir.slice(0, -(SHASHOKU_DIR.length + 1))
}

function metaRawOf(root: string): string {
  return serializeProjectJson({ ...defaultProjectJson(), pages: disk.get(root) ?? [] })
}

function stubWindow(opts?: { onReadProjectMeta?: (rootPath: string) => void }) {
  vi.stubGlobal('window', {
    api: {
      scanRoot: async () => ({ hasShashokuDir: true, hasSentinel: true }),
      openProject: async (root: string) => ({
        projectMetaRaw: metaRawOf(root),
        pages: (disk.get(root) ?? []).map((pageId) => ({
          pageId,
          pageDir: `${root}/${SHASHOKU_DIR}/pages/${pageId}`,
          badge: 'ok' as const,
        })),
      }),
      readProjectMeta: async (rootPath: string) => {
        opts?.onReadProjectMeta?.(rootPath)
        return metaRawOf(rootPath)
      },
      writeProjectMeta: async (shashokuDir: string, raw: string) => {
        disk.set(rootOfShashokuDir(shashokuDir), parseProjectJson(raw).pages)
      },
      readPage: async () => ({ manifestRaw: '', ocrRaw: null }),
      scanWorkspaces: async () => ({ roots: [], folders: [], books: [] }),
      listInside: async () => ({ book: false, pages: [], entries: [] }),
      writePreferences: async () => {},
    },
    engine: {
      maskReset: () => {},
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  disk.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('switching between books', () => {
  it('keeps a portable-only book’s history intact across a switch away and back', async () => {
    stubWindow()
    const project = useProjectStore()
    const editor = useEditorStore()
    const open = useOpenProject()

    expect(await open.openPath('/book-a')).toBe(true)
    const undone: string[] = []
    editor.pushCommand({
      label: 'portable-1',
      portable: true,
      do: () => {},
      undo: () => {
        undone.push('portable-1')
      },
    })

    expect(await open.openPath('/book-b')).toBe(true)
    expect(project.rootPath).toBe('/book-b')
    // A's stack survived the switch rather than being wiped by clearHistory.

    expect(await open.openPath('/book-a')).toBe(true)
    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(undone).toEqual(['portable-1'])
  })

  /**
   * Every command today is session-bound, so a book edited in the editor and
   * then left keeps only whatever portable run sat above the newest one of
   * them — with none, that is nothing.
   */
  it('cuts a session-bound command from the book being left', async () => {
    stubWindow()
    const editor = useEditorStore()
    const open = useOpenProject()

    await open.openPath('/book-a')
    editor.pushCommand({ label: 'session-1', do: () => {}, undo: () => {} })

    await open.openPath('/book-b')
    await open.openPath('/book-a')

    expect(editor.canUndo).toBe(false)
  })
})

/**
 * The two sequences that were silently doing nothing: a reorder made from the
 * shelf froze the writer it was pushed with, and opening the book destroyed
 * exactly that writer. Both undo through whichever authority owns the book at
 * the moment the key is pressed.
 */
describe('undoing a shelf reorder after the book has been opened', () => {
  it('takes the order back while that book is the one open in the editor', async () => {
    stubWindow()
    disk.set('/book-a', ['a', 'b', 'c'])
    const project = useProjectStore()
    const editor = useEditorStore()
    const order = useLibraryPageOrder()

    await order.reorderPagesTo('/book-a', ['c'], 0)
    expect(disk.get('/book-a')).toEqual(['c', 'a', 'b'])

    expect(await useOpenProject().openPath('/book-a')).toBe(true)
    expect(project.allFiles.map((f) => f.pageId)).toEqual(['c', 'a', 'b'])

    editor.undo('/book-a')
    expect(project.allFiles.map((f) => f.pageId)).toEqual(['a', 'b', 'c'])
  })

  it('takes it back from the shelf after that book has been left again', async () => {
    stubWindow()
    disk.set('/book-a', ['a', 'b', 'c'])
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()
    const opener = useOpenProject()

    await useLibraryPageOrder().reorderPagesTo('/book-a', ['c'], 0)
    await opener.openPath('/book-a')
    await opener.openPath('/book-b')

    editor.undo('/book-a')
    await bookMeta.flush('/book-a')

    expect(disk.get('/book-a')).toEqual(['a', 'b', 'c'])
  })

  /**
   * The order the shelf left debounced has to be on disk before the open
   * reads the file. Landing afterwards would put the editor's `allFiles` an
   * edit behind, and its own autosave would then write that back over the top.
   */
  it('lands the shelf’s pending write before the open reads the file', async () => {
    stubWindow()
    disk.set('/book-a', ['a', 'b', 'c'])
    const project = useProjectStore()
    const bookMeta = useBookMetaStore()

    // Marked and left debounced — no `flush`, which is what the gesture that
    // owns this write would normally have awaited before letting go.
    await bookMeta.handleFor('/book-a')
    expect(bookMeta.applyOrderSnapshot('/book-a', ['c', 'a', 'b'])).toBe(true)
    expect(disk.get('/book-a')).toEqual(['a', 'b', 'c'])

    await useOpenProject().openPath('/book-a')

    expect(project.allFiles.map((f) => f.pageId)).toEqual(['c', 'a', 'b'])
  })
})

describe('the handle a book is held by', () => {
  /**
   * Opening the book no longer throws its handle away — the history pointing
   * at it outlives the editor session, so the handle has to as well.
   */
  it('survives the editor opening and leaving that same book', async () => {
    let reads = 0
    stubWindow({ onReadProjectMeta: () => reads++ })
    const bookMeta = useBookMetaStore()
    const open = useOpenProject()

    disk.set('/book-a', ['a', 'b'])
    await bookMeta.handleFor('/book-a')
    expect(reads).toBe(1)

    await open.openPath('/book-a')
    await open.openPath('/book-b')

    expect((await bookMeta.handleFor('/book-a'))?.order).toEqual(['a', 'b'])
    expect(reads).toBe(1)
  })

  /**
   * A book reordered from the shelf while it was the open one never had a
   * handle — `projectStore` answered every read. Leaving it is the moment
   * that command's writer changes, so it is the moment the handle is made.
   */
  it('is made on the way out for a book that never had one', async () => {
    stubWindow()
    disk.set('/book-a', ['a', 'b', 'c'])
    const editor = useEditorStore()
    const bookMeta = useBookMetaStore()
    const opener = useOpenProject()

    await opener.openPath('/book-a')
    await useLibraryPageOrder().reorderPagesTo('/book-a', ['c'], 0)
    await opener.openPath('/book-b')

    editor.undo('/book-a')
    await bookMeta.flush('/book-a')

    expect(disk.get('/book-a')).toEqual(['a', 'b', 'c'])
  })
})

/**
 * The barrier ticket `09` asks for: a flush that answers "landed" when it did
 * not is how an open goes on to read the old file and drop the session that
 * held the change nobody saved.
 */
describe('a write that will not land stops the open', () => {
  it('refuses to open and says why, leaving the change still in hand', async () => {
    stubWindow()
    disk.set('/book-a', ['a', 'b', 'c'])
    const project = useProjectStore()
    const bookMeta = useBookMetaStore()

    await bookMeta.handleFor('/book-a')
    bookMeta.applyOrderSnapshot('/book-a', ['c', 'a', 'b'])
    vi.stubGlobal('window', {
      ...window,
      api: {
        ...window.api,
        writeProjectMeta: async () => {
          throw new Error('read-only file system')
        },
      },
    })

    const opener = useOpenProject()
    expect(await opener.openPath('/book-a')).toBe(false)
    expect(opener.lastError.value).toBeTruthy()
    expect(project.rootPath).toBeNull()

    // Still held, still owed — nothing was quietly dropped on the way past.
    expect((await bookMeta.handleFor('/book-a'))?.order).toEqual(['c', 'a', 'b'])
  })
})
