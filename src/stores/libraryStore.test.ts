import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DirEntry, FolderContents, ShelfLeaf } from '@shared/project/workspace'
import { entryKey, pageKey, useLibraryStore } from './libraryStore'

function entry(path: string, overrides: Partial<DirEntry> = {}): DirEntry {
  return {
    name: path,
    path,
    folder: false,
    book: false,
    own: false,
    cover: null,
    pageCount: null,
    books: null,
    ...overrides,
  }
}

function leaf(id: string): ShelfLeaf {
  return { id, name: id, cover: null, page: true }
}

const insideByPath = new Map<string, FolderContents>()

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeAll(() => {
  vi.stubGlobal('window', {
    api: {
      listInside: (path: string) =>
        Promise.resolve(insideByPath.get(path) ?? { book: false, pages: [], entries: [] }),
      scanWorkspaces: () => Promise.resolve({ roots: [], folders: [], books: [] }),
      pickWorkspace: () => Promise.resolve(null),
    },
  })
})

async function enterFolder(
  library: ReturnType<typeof useLibraryStore>,
  path: string,
  contents: FolderContents,
): Promise<void> {
  insideByPath.set(path, contents)
  library.standAt(path)
  await flushPromises()
}

describe('the shelf keeps two selections apart', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    insideByPath.clear()
  })

  it('keeps a range extension inside the band it started in', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/w', {
      book: false,
      pages: [],
      entries: [
        entry('/w/book-a', { folder: true, book: true, pageCount: 3 }),
        entry('/w/book-b', { folder: true, book: true, pageCount: 2 }),
        entry('/w/book-c', { folder: true, book: true, pageCount: 1 }),
        entry('/w/readme.txt'),
        entry('/w/cover.png'),
      ],
    })

    library.only('project', entryKey(library.bandProjects[0]))
    library.extendTo('project', entryKey(library.bandProjects[2]))

    expect(library.chosenItems).toHaveLength(3)
    expect(
      library.chosenItems.every((item) => item.kind === 'entry' && item.entry.book),
    ).toBe(true)
  })

  it('keeps a range extension inside the page band, the ShelfLeaf side of the split', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/book', {
      book: true,
      pages: [leaf('p1'), leaf('p2'), leaf('p3')],
      entries: [entry('/book/notes.txt')],
    })

    library.only('project', pageKey(library.bandPages[0]))
    library.extendTo('project', pageKey(library.bandPages[2]))

    expect(library.chosenItems).toHaveLength(3)
    expect(library.chosenItems.every((item) => item.kind === 'page')).toBe(true)
  })

  it('empties the file band when the project band is touched, and back again', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/w', {
      book: false,
      pages: [],
      entries: [
        entry('/w/book-a', { folder: true, book: true, pageCount: 1 }),
        entry('/w/readme.txt'),
      ],
    })
    const bookKey = entryKey(library.bandProjects[0])
    const fileKey = entryKey(library.bandFiles[0])

    library.only('file', fileKey)
    expect(library.isChosen(fileKey)).toBe(true)

    library.only('project', bookKey)
    expect(library.isChosen(bookKey)).toBe(true)
    expect(library.isChosen(fileKey)).toBe(false)

    library.only('file', fileKey)
    expect(library.isChosen(fileKey)).toBe(true)
    expect(library.isChosen(bookKey)).toBe(false)
  })

  it('falls back to the file band when the project band is empty, and re-checks on every move', async () => {
    const library = useLibraryStore()

    await enterFolder(library, '/a', { book: false, pages: [], entries: [entry('/a/only.txt')] })
    expect(library.focus).toBe('file')

    await enterFolder(library, '/b', {
      book: false,
      pages: [],
      entries: [entry('/b/book', { folder: true, book: true, pageCount: 1 })],
    })
    expect(library.focus).toBe('project')

    await enterFolder(library, '/c', { book: false, pages: [], entries: [entry('/c/only.txt')] })
    expect(library.focus).toBe('file')
  })

  it('chooseAll selects only the band that currently holds focus', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/w', {
      book: false,
      pages: [],
      entries: [
        entry('/w/book-a', { folder: true, book: true, pageCount: 1 }),
        entry('/w/book-b', { folder: true, book: true, pageCount: 1 }),
        entry('/w/readme.txt'),
        entry('/w/cover.png'),
      ],
    })

    expect(library.focus).toBe('project')
    library.chooseAll()
    expect(library.chosenItems).toHaveLength(library.bandProjects.length)
    expect(
      library.chosenItems.every((item) => item.kind === 'entry' && item.entry.book),
    ).toBe(true)

    library.only('file', entryKey(library.bandFiles[0]))
    library.chooseAll()
    expect(library.chosenItems).toHaveLength(library.bandFiles.length)
    expect(
      library.chosenItems.every((item) => item.kind === 'entry' && !item.entry.book),
    ).toBe(true)
  })

  it('frameSelect replaces a band, anchored on the first hit in band order', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/w', {
      book: false,
      pages: [],
      entries: [
        entry('/w/book-a', { folder: true, book: true, pageCount: 1 }),
        entry('/w/book-b', { folder: true, book: true, pageCount: 1 }),
        entry('/w/book-c', { folder: true, book: true, pageCount: 1 }),
        entry('/w/readme.txt'),
      ],
    })
    const [a, , c] = library.bandProjects.map((each) => entryKey(each))

    library.frameSelect('project', [c, a])

    expect(library.chosenItems.map((item) => item.key)).toEqual([a, c])
    expect(library.cursor).toBe(a)
  })

  it('frameSelect on one band clears the other, like touching it any other way', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/w', {
      book: false,
      pages: [],
      entries: [
        entry('/w/book-a', { folder: true, book: true, pageCount: 1 }),
        entry('/w/readme.txt'),
      ],
    })
    const bookKey = entryKey(library.bandProjects[0])
    const fileKey = entryKey(library.bandFiles[0])

    library.only('file', fileKey)
    library.frameSelect('project', [bookKey])

    expect(library.isChosen(bookKey)).toBe(true)
    expect(library.isChosen(fileKey)).toBe(false)
    expect(library.focus).toBe('project')
  })

  it('frameSelect with no hits clears the band, the way an empty marquee does', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/w', { book: false, pages: [], entries: [entry('/w/only.txt')] })
    const fileKey = entryKey(library.bandFiles[0])

    library.only('file', fileKey)
    library.frameSelect('file', [])

    expect(library.chosenItems).toHaveLength(0)
    expect(library.cursor).toBeNull()
  })

  it('chosenIn snapshots a band without tracking further changes to it', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/w', {
      book: false,
      pages: [],
      entries: [
        entry('/w/book-a', { folder: true, book: true, pageCount: 1 }),
        entry('/w/book-b', { folder: true, book: true, pageCount: 1 }),
      ],
    })
    const [a, b] = library.bandProjects.map((each) => entryKey(each))
    library.only('project', a)

    const snapshot = library.chosenIn('project')
    library.frameSelect('project', [a, b])

    expect(snapshot).toEqual([a])
    expect(library.chosenIn('project')).toEqual([a, b])
  })

  it('Esc clears the selection but leaves focus where it was', async () => {
    const library = useLibraryStore()
    await enterFolder(library, '/w', { book: false, pages: [], entries: [entry('/w/only.txt')] })
    expect(library.focus).toBe('file')

    library.only('file', entryKey(library.bandFiles[0]))
    expect(library.chosenItems).toHaveLength(1)

    library.clearChoice()

    expect(library.chosenItems).toHaveLength(0)
    expect(library.focus).toBe('file')
  })
})
