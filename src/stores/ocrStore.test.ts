import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { emptyCounters } from '@shared/page/numbers'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import type { LayerEntry, RasterLayerEntry } from '@shared/page/types'
import type { OcrPageResult } from '@shared/ocr/types'
import { useProjectStore } from '@/stores/projectStore'
import { useOcrStore } from '@/stores/ocrStore'

const NOTHING: OcrPageResult = { regions: [], readings: [] } as unknown as OcrPageResult

/** Each trip waits until the test lets it finish, so what runs alongside what can be seen. */
let trips: { path: string; finish: (ok: boolean) => void }[] = []

beforeEach(() => {
  trips = []
  vi.stubGlobal('window', {
    ocr: {
      onProgress: () => {},
      // The renderer's tsconfig stops short of es2024, so no Promise.withResolvers.
      readPage: (path: string) =>
        new Promise<OcrPageResult>((resolve, reject) => {
          trips.push({ path, finish: (ok) => (ok ? resolve(NOTHING) : reject(new Error('sidecar gone'))) })
        }),
    },
  })
  setActivePinia(createPinia())
})

const artwork = (pageId: string) => ({ kind: 'raster', id: `r-${pageId}`, name: 'art', file: `${pageId}.png` }) as RasterLayerEntry

function chapter(pages: { id: string; layers: LayerEntry[] }[]) {
  const project = useProjectStore()
  project.allFiles = pages.map(({ id, layers }) => ({
    pageId: id,
    pageDir: `/b/${id}`,
    ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 10, height: 10, candidates: [] },
    badge: 'ok' as const,
    page: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: id,
      width: 10,
      height: 10,
      ledgers: {},
      readingOrder: [],
      readingEdges: [],
      counters: emptyCounters(),
      layers,
    },
  }))
  return useOcrStore()
}

/** Lets the run's awaits move on; no clock is involved anywhere in it. */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
const read = () => trips.map((t) => t.path.split('/').at(-1))

describe('reading the whole chapter', () => {
  /** ⭐ One trip at a time: two pages at once would hold two models' weights. */
  it('reads the pages with artwork in order, each after the last has finished', async () => {
    const ocr = chapter([
      { id: 'p1', layers: [artwork('p1')] },
      { id: 'p2', layers: [] },
      { id: 'p3', layers: [artwork('p3')] },
    ])
    const run = ocr.readChapter()
    await flush()
    expect(read()).toEqual(['p1.png'])
    expect(ocr.chapter).toEqual({ at: 1, of: 2, pageId: 'p1' })
    trips[0]!.finish(true)
    await flush()
    expect(read()).toEqual(['p1.png', 'p3.png'])
    trips[1]!.finish(true)
    await run
    expect(ocr.chapter).toBeNull()
  })

  it('stops after the page in hand when asked, never inside it', async () => {
    const ocr = chapter([
      { id: 'p1', layers: [artwork('p1')] },
      { id: 'p2', layers: [artwork('p2')] },
    ])
    const run = ocr.readChapter()
    await flush()
    ocr.stopChapter()
    expect(ocr.stopping).toBe(true)
    trips[0]!.finish(true)
    await run
    expect(read()).toEqual(['p1.png'])
    expect(ocr.stopping).toBe(false)
  })

  /** ⚠️ A sidecar that cannot read one page cannot read the next either. */
  it('stops at the first page that fails and says why', async () => {
    const ocr = chapter([
      { id: 'p1', layers: [artwork('p1')] },
      { id: 'p2', layers: [artwork('p2')] },
    ])
    const run = ocr.readChapter()
    await flush()
    trips[0]!.finish(false)
    await run
    expect(read()).toEqual(['p1.png'])
    expect(ocr.problem).toBe('sidecar gone')
  })
})
