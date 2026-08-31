import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useOpenProject } from './useOpenProject'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { defaultProjectJson, serializeProjectJson } from '@shared/project/schema'

function stubWindow(opts?: { onReadProjectMeta?: (rootPath: string) => void }) {
  vi.stubGlobal('window', {
    api: {
      scanRoot: async () => ({ hasShashokuDir: true, hasSentinel: true }),
      openProject: async () => ({
        projectMetaRaw: serializeProjectJson(defaultProjectJson()),
        pages: [],
      }),
      readProjectMeta: async (rootPath: string) => {
        opts?.onReadProjectMeta?.(rootPath)
        return serializeProjectJson(defaultProjectJson())
      },
      writeProjectMeta: async () => {},
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
      undo: () => undone.push('portable-1'),
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

  /**
   * The book just opened has exactly one writer, `projectStore`'s own
   * autosave — a book-meta session cached from before it was opened would be
   * stale the moment that autosave writes, so opening it drops the cache.
   */
  it('forgets a book-meta session once the editor opens that same book', async () => {
    let reads = 0
    stubWindow({ onReadProjectMeta: () => reads++ })
    const bookMeta = useBookMetaStore()
    const open = useOpenProject()

    await bookMeta.sessionFor('/book-a')
    expect(reads).toBe(1)

    await open.openPath('/book-a')
    // Left again, so the library could ask for a fresh session once more.
    await open.openPath('/book-b')

    await bookMeta.sessionFor('/book-a')
    expect(reads).toBe(2)
  })
})
