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
   * The window holds itself open until the caller answers. A write that
   * throws costs that one write, not the reply — each scheduler has already
   * reported its own failure by the time this resolves.
   */
  it('still resolves when one of the writes throws', async () => {
    stubWindow({
      onWrite: () => {
        throw new Error('read-only file system')
      },
    })
    const bookMeta = useBookMetaStore()
    await bookMeta.handleFor(ROOT)
    bookMeta.applyOrderSnapshot(ROOT, ['b', 'a'])

    await expect(useCloseSettle().settle()).resolves.toBeUndefined()
  })
})
