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

describe('sessionFor', () => {
  it('starts a session from what is on disk', async () => {
    stubApi()
    const bookMeta = useBookMetaStore()

    const session = await bookMeta.sessionFor(ROOT)

    expect(session?.order).toEqual(['a', 'b'])
    expect(session?.dirty).toBe(false)
  })

  it('starts from defaults when the book has never been saved', async () => {
    stubApi({ meta: null })
    const bookMeta = useBookMetaStore()

    const session = await bookMeta.sessionFor(ROOT)

    expect(session?.order).toEqual([])
  })

  it('reads a book once and serves the cache after that', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    const bookMeta = useBookMetaStore()

    await bookMeta.sessionFor(ROOT)
    await bookMeta.sessionFor(ROOT)

    expect(reads).toBe(1)
  })

  it('shares one read between concurrent callers of the same book', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    const bookMeta = useBookMetaStore()

    const [a, b] = await Promise.all([bookMeta.sessionFor(ROOT), bookMeta.sessionFor(ROOT)])

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

    expect(await bookMeta.sessionFor(ROOT)).toBeNull()
    expect(reads).toBe(0)
  })
})

describe('setOrder', () => {
  it('refuses a book that has not been read into a session yet', () => {
    stubApi()
    const bookMeta = useBookMetaStore()

    expect(bookMeta.setOrder(ROOT, ['a'])).toBe(false)
  })

  it('refuses the book the editor already has open', async () => {
    stubApi()
    const bookMeta = useBookMetaStore()
    await bookMeta.sessionFor(ROOT)
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
    await bookMeta.sessionFor(ROOT)

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
    await bookMeta.sessionFor(ROOT)

    await bookMeta.flush(ROOT)

    expect(writes).toBe(0)
  })
})

describe('forget', () => {
  it('drops the cached session, so the next read goes to disk again', async () => {
    let reads = 0
    stubApi({ onRead: () => reads++ })
    const bookMeta = useBookMetaStore()

    await bookMeta.sessionFor(ROOT)
    bookMeta.forget(ROOT)
    await bookMeta.sessionFor(ROOT)

    expect(reads).toBe(2)
  })
})
