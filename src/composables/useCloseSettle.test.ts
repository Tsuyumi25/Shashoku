import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useCloseSettle } from './useCloseSettle'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { defaultProjectJson, parseProjectJson, serializeProjectJson } from '@shared/project/schema'

const ROOT = '/library/book-a'

let written: string[][] = []

function stubWindow(opts?: { onWrite?: () => void }) {
  vi.stubGlobal('window', {
    api: {
      readProjectMeta: async () =>
        serializeProjectJson({ ...defaultProjectJson(), pages: ['a', 'b'] }),
      writeProjectMeta: async (_dir: string, raw: string) => {
        opts?.onWrite?.()
        written.push(parseProjectJson(raw).pages)
      },
      writePreferences: async () => {},
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  written = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('settling before the window closes', () => {
  /**
   * An undo made on the shelf writes through that book's own handle, on a
   * debounce of its own. Quitting straight afterwards used to leave it there:
   * the close flow only ever banked the open project and the preferences.
   */
  it('lands a shelf write on a book the editor never opened', async () => {
    stubWindow()
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)
    bookMeta.applyOrderSnapshot(ROOT, ['b', 'a'])

    await useCloseSettle().settle()

    expect(written).toEqual([['b', 'a']])
  })

  /**
   * Answering the window at all is what lets it close, so resolving on a write
   * that threw closed it over work that was never written — with nothing on
   * screen to say so. The caller now has something to put to the user.
   */
  it('raises a write that did not land', async () => {
    stubWindow({
      onWrite: () => {
        throw new Error('read-only file system')
      },
    })
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)
    bookMeta.applyOrderSnapshot(ROOT, ['b', 'a'])

    await expect(useCloseSettle().settle()).rejects.toThrow('read-only file system')
  })

  /**
   * Every scheduler still gets its turn. Stopping at the first to throw would
   * leave the others holding bytes nobody asks for again — the window is on
   * its way out, and there is no later.
   */
  it('gives the writes that can still land their turn', async () => {
    let attempts = 0
    stubWindow({
      onWrite: () => {
        attempts += 1
        throw new Error('read-only file system')
      },
    })
    const bookMeta = useBookMetaStore()
    for (const root of [ROOT, '/library/book-b']) {
      await bookMeta.handleFor(root)
      bookMeta.applyOrderSnapshot(root, ['b', 'a'])
    }

    await expect(useCloseSettle().settle()).rejects.toThrow()
    expect(attempts).toBe(2)
  })
})
