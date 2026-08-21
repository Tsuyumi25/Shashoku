import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import type { RasterLayerEntry } from '@shared/page/types'
import { useLayerPlacement } from '@/composables/useLayerPlacement'
import type { LayerBitmaps } from '@/composables/useLayerBitmaps'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useRasterStore } from '@/stores/rasterStore'

/**
 * Letting go of a moved layer, against a layer whose pixels are ahead of the
 * manifest — which is every layer that has just been painted on, for as long as
 * the pixel scheduler takes to write it.
 */

const PAGE_ID = 'source-260809-1200'
const PAGE = { w: 400, h: 300 }

class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return {
      drawImage: () => {},
      putImageData: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(0, w * h * 4)),
      }),
    }
  }
  convertToBlob() {
    return Promise.resolve(new Blob([new Uint8Array([1])]))
  }
}

beforeAll(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas)
  vi.stubGlobal('createImageBitmap', () => Promise.resolve({ close: () => {} }))
  vi.stubGlobal('window', {
    api: {
      readImage: () => Promise.resolve(new Uint8Array([1])),
      writePage: () => Promise.resolve(),
      writeManifest: () => Promise.resolve(),
      deleteLayerParts: () => Promise.resolve(),
    },
  })
})

/** Enough of the page's bitmap cache to be handed a resample. */
const bitmaps = {
  get: () => undefined,
  adopt: () => {},
  revision: ref(0),
} as unknown as LayerBitmaps

function raster(extra: Partial<RasterLayerEntry> = {}): RasterLayerEntry {
  return {
    kind: 'raster',
    id: 'r',
    name: 'r',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    file: 'r.png',
    x: 10,
    y: 10,
    w: 40,
    h: 40,
    alphaLocked: false,
    ...extra,
  }
}

function open(entry: RasterLayerEntry) {
  const project = useProjectStore()
  project.rootPath = '/root'
  project.allFiles = [
    {
      pageId: PAGE_ID,
      pageDir: `/root/shashoku/pages/${PAGE_ID}`,
      page: { ...defaultManifest('source', PAGE.w, PAGE.h), layers: [] },
      ocr: defaultOcr(PAGE.w, PAGE.h),
      badge: 'ok',
    },
  ]
  project.addLayer(PAGE_ID, entry)
  const editor = useEditorStore()
  editor.currentPageId = PAGE_ID
  return { project, editor }
}

/**
 * Stands in for the pixel write landing: the layer goes down under a name
 * nothing has held before and the manifest is told the frame it grew to, both
 * of which only happen once `flush` has run.
 */
function settlesTo(place: Partial<RasterLayerEntry>) {
  const project = useProjectStore()
  return vi.spyOn(useRasterStore(), 'flush').mockImplementation(async () => {
    project.placeLayer(PAGE_ID, 'r', {
      file: place.file ?? 'r.png',
      x: place.x ?? 10,
      y: place.y ?? 10,
      w: place.w ?? 40,
      h: place.h ?? 40,
    })
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.restoreAllMocks()
})

describe('letting go of a moved layer', () => {
  /**
   * The write renames the file and the old one is gone from disk, so a move
   * settled against the entry from before it points the page at nothing — and
   * takes the frame back to before the stroke while it is at it.
   */
  it('writes the layer down as it stands after the pixels settled, not before', async () => {
    const { editor } = open(raster())
    const placement = useLayerPlacement(bitmaps)
    const entry = { ...raster() }
    settlesTo({ file: 'r.9f3c1a.png', w: 60, h: 60 })
    const placed = vi.spyOn(editor, 'cmdPlaceLayer')

    placement.moveBy('r', { dx: 25, dy: 0 })
    await placement.commit(entry)

    expect(placed).toHaveBeenCalledTimes(1)
    const [, , from, to] = placed.mock.calls[0]
    expect(from.file).toBe('r.9f3c1a.png')
    expect(from.w).toBe(60)
    expect(to.file).toBe('r.9f3c1a.png')
    expect(to.x).toBe(35)
  })

  /**
   * A layer painted for the first time has no frame in the manifest until that
   * write lands, and it is reachable on screen well before that — the canvas
   * hit-tests where the pixels are. Refusing on the entry's emptiness would
   * drop the whole gesture without a word.
   */
  it('moves a layer whose first stroke had not reached the manifest yet', async () => {
    const { editor } = open(raster({ x: 0, y: 0, w: 0, h: 0 }))
    const placement = useLayerPlacement(bitmaps)
    const entry = { ...raster({ x: 0, y: 0, w: 0, h: 0 }) }
    settlesTo({ file: 'r.9f3c1a.png', x: 10, y: 10, w: 40, h: 40 })
    const placed = vi.spyOn(editor, 'cmdPlaceLayer')

    placement.moveBy('r', { dx: 25, dy: 0 })
    await placement.commit(entry)

    expect(placed).toHaveBeenCalledTimes(1)
    expect(placed.mock.calls[0][3].x).toBe(35)
  })

  /** Nothing anywhere has pixels for it, which is a different thing. */
  it('lets go of a layer that has no pixels at all without writing anything', async () => {
    const { editor } = open(raster({ w: 0, h: 0 }))
    const placement = useLayerPlacement(bitmaps)
    settlesTo({ w: 0, h: 0 })
    const placed = vi.spyOn(editor, 'cmdPlaceLayer')

    placement.moveBy('r', { dx: 25, dy: 0 })
    await placement.commit(raster({ w: 0, h: 0 }))

    expect(placed).not.toHaveBeenCalled()
    expect(placement.held.value).toBeNull()
  })
})

describe('a gesture in progress', () => {
  /**
   * The box on screen is drawn at the frame the pixels are really at, so a
   * ratio worked out against the entry's would scale by the wrong amount for
   * as long as the manifest is behind.
   */
  it('scales against the frame the layer is drawn at, not the one recorded', async () => {
    open(raster())
    const raster2 = useRasterStore()
    vi.spyOn(raster2, 'frameOf').mockReturnValue({ x: 10, y: 10, w: 80, h: 80 })
    const placement = useLayerPlacement(bitmaps)

    // Half of the frame on screen. Against the entry's 40 it would be clamped
    // up to a floor of 1/40 and come out as a different picture entirely.
    placement.scaleTo('r', 0.5, { x: 0, y: 0 })

    expect(placement.placementOf('r').scale).toBe(0.5)
    // Pinned at the top-left corner, so the middle walks in by a quarter of the
    // frame that is really there — 20, not 10.
    expect(placement.placementOf('r').dx).toBe(-20)
  })
})
