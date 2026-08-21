import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useLayerBitmaps } from '@/composables/useLayerBitmaps'

/** A stand-in for the decode, which is the one thing this cache is holding. */
interface FakeBitmap {
  file: string
  closed: boolean
  close(): void
}

const decoded: FakeBitmap[] = []
const reads: string[] = []

/** Which files a read is refused for, so the failure path can be exercised. */
const missing = new Set<string>()

function readImage(_dir: string, file: string): Promise<Uint8Array> {
  reads.push(file)
  if (missing.has(file)) return Promise.reject(new Error('gone'))
  return Promise.resolve(new Uint8Array([file.charCodeAt(0)]))
}

/**
 * The decode is asked for a `Blob`, so what came back from the read has to be
 * carried through it — this is how the fake learns which file it stands for.
 */
async function createFakeBitmap(blob: Blob): Promise<FakeBitmap> {
  const byte = new Uint8Array(await blob.arrayBuffer())[0]
  const bitmap: FakeBitmap = {
    file: String.fromCharCode(byte),
    closed: false,
    close(): void {
      this.closed = true
    },
  }
  decoded.push(bitmap)
  return bitmap
}

/** Long enough for a read and a decode to land for every file asked for. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  decoded.length = 0
  reads.length = 0
  missing.clear()
  vi.stubGlobal('window', { api: { readImage } })
  vi.stubGlobal('createImageBitmap', createFakeBitmap)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The cache under a scope of its own, so disposing it is something a test can do. */
function mount(dir: () => string | null, wanted: () => readonly string[]) {
  const scope = effectScope()
  const bitmaps = scope.run(() => useLayerBitmaps(dir, wanted))
  if (bitmaps === undefined) throw new Error('scope did not run')
  return { bitmaps, dispose: () => scope.stop() }
}

describe('useLayerBitmaps', () => {
  it('hands back the bitmap it decoded for each wanted file', async () => {
    const { bitmaps, dispose } = mount(
      () => 'layers',
      () => ['a.png', 'b.png'],
    )
    await settle()

    expect((bitmaps.get('a.png') as unknown as FakeBitmap).file).toBe('a')
    expect((bitmaps.get('b.png') as unknown as FakeBitmap).file).toBe('b')
    dispose()
  })

  it('has nothing for a file whose read has not landed', () => {
    const { bitmaps, dispose } = mount(
      () => 'layers',
      () => ['a.png'],
    )

    expect(bitmaps.get('a.png')).toBeUndefined()
    dispose()
  })

  /**
   * The whole reason this is not held by whoever draws it: the canvas re-cuts
   * the stack into different elements for the same page, and a second decode
   * there is a blink of nothing.
   */
  it('does not read a file again when the wanted list is asked for anew', async () => {
    const wanted = ref<readonly string[]>(['a.png', 'b.png'])
    const { bitmaps, dispose } = mount(
      () => 'layers',
      () => wanted.value,
    )
    await settle()

    wanted.value = ['b.png', 'a.png', 'c.png']
    await settle()

    expect(reads).toEqual(['a.png', 'b.png', 'c.png'])
    expect((bitmaps.get('a.png') as unknown as FakeBitmap).closed).toBe(false)
    dispose()
  })

  it('closes and forgets a file the page no longer draws', async () => {
    const wanted = ref<readonly string[]>(['a.png', 'b.png'])
    const { bitmaps, dispose } = mount(
      () => 'layers',
      () => wanted.value,
    )
    await settle()
    const gone = bitmaps.get('a.png') as unknown as FakeBitmap

    wanted.value = ['b.png']
    await settle()

    expect(gone.closed).toBe(true)
    expect(bitmaps.get('a.png')).toBeUndefined()
    dispose()
  })

  it('drops everything it holds when the page turns', async () => {
    const dir = ref<string | null>('one/layers')
    const wanted = ref<readonly string[]>(['a.png'])
    const { bitmaps, dispose } = mount(
      () => dir.value,
      () => wanted.value,
    )
    await settle()
    const first = bitmaps.get('a.png') as unknown as FakeBitmap

    dir.value = 'two/layers'
    wanted.value = ['z.png']
    await settle()

    expect(first.closed).toBe(true)
    expect((bitmaps.get('z.png') as unknown as FakeBitmap).file).toBe('z')
    dispose()
  })

  it('closes what it holds when the canvas goes away', async () => {
    const { bitmaps, dispose } = mount(
      () => 'layers',
      () => ['a.png'],
    )
    await settle()
    const held = bitmaps.get('a.png') as unknown as FakeBitmap

    dispose()

    expect(held.closed).toBe(true)
  })

  it('counts up as each read lands, so whoever draws is told to draw again', async () => {
    const { bitmaps, dispose } = mount(
      () => 'layers',
      () => ['a.png', 'b.png'],
    )
    expect(bitmaps.revision.value).toBe(0)
    await settle()

    expect(bitmaps.revision.value).toBe(2)
    dispose()
  })

  it('leaves the rest of the page drawable when one file cannot be read', async () => {
    missing.add('a.png')
    const { bitmaps, dispose } = mount(
      () => 'layers',
      () => ['a.png', 'b.png'],
    )
    await settle()

    expect(bitmaps.get('a.png')).toBeUndefined()
    expect((bitmaps.get('b.png') as unknown as FakeBitmap).file).toBe('b')
    dispose()
  })

  /**
   * A resample mints a file name and the entry points at it at once, so the
   * pixels have to be there before the read that would otherwise fetch them.
   */
  describe('taking in pixels that were not read', () => {
    function fake(file: string): FakeBitmap {
      return {
        file,
        closed: false,
        close(): void {
          this.closed = true
        },
      }
    }

    it('hands back adopted pixels without ever reading their file', async () => {
      const wanted = ref<readonly string[]>(['a.png'])
      const { bitmaps, dispose } = mount(
        () => 'layers',
        () => wanted.value,
      )
      await settle()

      bitmaps.adopt('layers', 'a.rev2.png', fake('baked') as unknown as ImageBitmap)
      wanted.value = ['a.rev2.png']
      await settle()

      expect((bitmaps.get('a.rev2.png') as unknown as FakeBitmap).file).toBe('baked')
      expect(reads).toEqual(['a.png'])
      dispose()
    })

    it('drops adopted pixels the page turned away from', async () => {
      const dir = ref<string | null>('one/layers')
      const wanted = ref<readonly string[]>(['a.png'])
      const { bitmaps, dispose } = mount(
        () => dir.value,
        () => wanted.value,
      )
      await settle()
      const baked = fake('baked')
      bitmaps.adopt('one/layers', 'a.rev2.png', baked as unknown as ImageBitmap)

      dir.value = 'two/layers'
      wanted.value = ['z.png']
      await settle()

      expect(baked.closed).toBe(true)
      dispose()
    })

    it('refuses pixels belonging to a page that is no longer on screen', async () => {
      const dir = ref<string | null>('one/layers')
      const { bitmaps, dispose } = mount(
        () => dir.value,
        () => ['a.png'],
      )
      await settle()
      dir.value = 'two/layers'
      await settle()

      const stale = fake('baked')
      bitmaps.adopt('one/layers', 'a.rev2.png', stale as unknown as ImageBitmap)

      expect(stale.closed).toBe(true)
      expect(bitmaps.get('a.rev2.png')).toBeUndefined()
      dispose()
    })
  })

  it('reads nothing before the page names a folder', async () => {
    const { dispose } = mount(
      () => null,
      () => ['a.png'],
    )
    await settle()

    expect(reads).toEqual([])
    dispose()
  })
})
