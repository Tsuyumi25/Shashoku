import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBookMetaStore } from './bookMetaStore'
import { useProjectStore } from './projectStore'
import { defaultProjectJson, parseProjectJson, serializeProjectJson } from '@shared/project/schema'

const ROOT = '/library/some-book'

function stubApi(opts?: {
  meta?: string | null
  onWrite?: (shashokuDir: string, raw: string) => void
  onRead?: () => void
}) {
  vi.stubGlobal('window', {
    api: {
      readProjectMeta: async () => {
        opts?.onRead?.()
        return opts && Object.hasOwn(opts, 'meta')
          ? opts.meta
          : serializeProjectJson({ ...defaultProjectJson(), pages: ['a', 'b'] })
      },
      writeProjectMeta: async (shashokuDir: string, raw: string) => {
        opts?.onWrite?.(shashokuDir, raw)
      },
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleFor', () => {
  it('starts a handle from what is on disk', async () => {
    stubApi()
    const bookMeta = useBookMetaStore()

    const handle = await bookMeta.handleFor(ROOT)

    expect(handle?.order).toEqual(['a', 'b'])
    expect(handle?.dirty).toBe(false)
  })

  it('starts from defaults when the book has never been saved', async () => {
    stubApi({ meta: null })
    const bookMeta = useBookMetaStore()

    const handle = await bookMeta.handleFor(ROOT)

    expect(handle?.order).toEqual([])
  })

  it('reads a book once and serves the cache after that', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    const bookMeta = useBookMetaStore()

    await bookMeta.handleFor(ROOT)
    await bookMeta.handleFor(ROOT)

    expect(reads).toBe(1)
  })

  it('shares one read between concurrent callers of the same book', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    const bookMeta = useBookMetaStore()

    const [a, b] = await Promise.all([bookMeta.handleFor(ROOT), bookMeta.handleFor(ROOT)])

    expect(reads).toBe(1)
    expect(a).toBe(b)
  })

  /**
   * The book the editor already has open has exactly one writer: its own
   * autosave. A second reader here would go stale the moment that autosave
   * writes, with nothing to say the copy in hand no longer matches the disk.
   */
  it('refuses the book the editor already has open', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    useProjectStore().rootPath = ROOT
    const bookMeta = useBookMetaStore()

    expect(await bookMeta.handleFor(ROOT)).toBeNull()
    expect(reads).toBe(0)
  })
})

describe('setOrder', () => {
  it('refuses a book that has not been read into a handle yet', () => {
    stubApi()
    const bookMeta = useBookMetaStore()

    expect(bookMeta.setOrder(ROOT, ['a'])).toBe(false)
  })

  it('refuses the book the editor already has open', async () => {
    stubApi()
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)
    useProjectStore().rootPath = ROOT

    expect(bookMeta.setOrder(ROOT, ['b', 'a'])).toBe(false)
  })

  /**
   * The scenario the ticket exists for: `do → undo → redo` faster than one
   * flush must still leave the disk agreeing with the screen, not with
   * whatever the middle write happened to be.
   */
  it('collapses a rapid do → undo → redo into one write carrying the final order', async () => {
    const writes: string[][] = []
    stubApi({ onWrite: (_dir, raw) => writes.push(parseProjectJson(raw).pages) })
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)

    bookMeta.setOrder(ROOT, ['b', 'a']) // do
    bookMeta.setOrder(ROOT, ['a', 'b']) // undo
    bookMeta.setOrder(ROOT, ['b', 'a']) // redo
    await bookMeta.flush(ROOT)

    expect(writes).toEqual([['b', 'a']])
  })

  it('writes nothing when nothing was ever marked dirty', async () => {
    let writes = 0
    stubApi({ onWrite: () => writes++ })
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)

    await bookMeta.flush(ROOT)

    expect(writes).toBe(0)
  })
})

describe('forget', () => {
  it('drops the cached handle, so the next read goes to disk again', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    const bookMeta = useBookMetaStore()

    await bookMeta.handleFor(ROOT)
    bookMeta.forget(ROOT)
    await bookMeta.handleFor(ROOT)

    expect(reads).toBe(2)
  })
})

describe('handBack', () => {
  /**
   * The book was the open one, so `handleFor` refused it and there is no
   * handle at all — until the editor lets go of it, which is the moment
   * anything still pointing at that book starts needing one.
   */
  it('makes a handle for a book that never had one', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    const bookMeta = useBookMetaStore()

    bookMeta.handBack(ROOT, { ...defaultProjectJson(), pages: ['b', 'a'] }, ['b', 'a'])

    expect((await bookMeta.handleFor(ROOT))?.order).toEqual(['b', 'a'])
    expect(reads).toBe(0)
  })

  it('replaces what a stale handle held with the order the editor is holding', async () => {
    stubApi()
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)

    bookMeta.handBack(ROOT, { ...defaultProjectJson(), pages: ['a', 'b', 'c'] }, ['a', 'b', 'c'])

    expect((await bookMeta.handleFor(ROOT))?.order).toEqual(['a', 'b', 'c'])
  })

  /** A write already scheduled is still owed; taking the book back is not paying it. */
  it('keeps a write that was already scheduled', async () => {
    const writes: string[][] = []
    stubApi({ onWrite: (_dir, raw) => writes.push(parseProjectJson(raw).pages) })
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)
    bookMeta.setOrder(ROOT, ['b', 'a'])

    bookMeta.handBack(ROOT, { ...defaultProjectJson(), pages: ['b', 'a'] }, ['b', 'a'])
    await bookMeta.flush(ROOT)

    expect(writes).toEqual([['b', 'a']])
  })
})

describe('flushAll', () => {
  it('lands every book that has a write still pending', async () => {
    const written = new Map<string, string[]>()
    stubApi({ onWrite: (dir, raw) => written.set(dir, parseProjectJson(raw).pages) })
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor('/one')
    await bookMeta.handleFor('/two')
    bookMeta.setOrder('/one', ['b', 'a'])
    bookMeta.setOrder('/two', ['a'])

    await bookMeta.flushAll()

    expect([...written.values()]).toEqual([['b', 'a'], ['a']])
  })
})

describe('retire', () => {
  it('lets a clean handle go, so the next read goes to disk again', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    const bookMeta = useBookMetaStore()

    await bookMeta.handleFor(ROOT)
    await bookMeta.retire(ROOT)
    await bookMeta.handleFor(ROOT)

    expect(reads).toBe(2)
  })

  it('writes what a dirty handle was holding before letting it go', async () => {
    const writes: string[][] = []
    stubApi({ onWrite: (_dir, raw) => writes.push(parseProjectJson(raw).pages) })
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)
    bookMeta.setOrder(ROOT, ['b', 'a'])

    await bookMeta.retire(ROOT)

    expect(writes).toEqual([['b', 'a']])
  })

  /**
   * The one way a change already accepted from the user could disappear with
   * nothing saying so. A handle whose write did not land stays put, still
   * holding it, for whoever flushes next.
   */
  it('keeps a handle whose write failed', async () => {
    stubApi({
      onWrite: () => {
        throw new Error('disk full')
      },
    })
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)
    bookMeta.setOrder(ROOT, ['b', 'a'])

    await bookMeta.retire(ROOT)

    expect((await bookMeta.handleFor(ROOT))?.order).toEqual(['b', 'a'])
  })
})
