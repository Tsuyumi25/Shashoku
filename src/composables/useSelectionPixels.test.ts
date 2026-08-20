import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createPinia, setActivePinia } from 'pinia'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import type { GroupLayerEntry, RasterLayerEntry, TextLayerEntry } from '@shared/page/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { rasterizeRect } from '@/lib/selection/raster'
import { useSelectionPixels } from '@/composables/useSelectionPixels'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'

/**
 * The real engine, not a stand-in. The selection's coverage lives in its tiles,
 * so making a selection here goes through the same addon preload hands the
 * renderer — which is why `pnpm test` needs `pnpm engine:build` to have run.
 */
const engine = createRequire(import.meta.url)('@shashoku/engine') as Window['engine']

const PAGE_ID = 'source-260809-1200'
const PAGE = { page: PAGE_ID, w: 1200, h: 1700 }

function raster(id: string, extra: Partial<RasterLayerEntry> = {}): RasterLayerEntry {
  return {
    kind: 'raster',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    file: `${id}.png`,
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    alphaLocked: false,
    ...extra,
  }
}

function text(id: string): TextLayerEntry {
  return {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    tags: [],
    rotation: 0,
    lines: [id],
    source: { hash: null, by: 'auto' },
    ownSource: '',
    translations: [],
    translation: null,
    style: { ...DEFAULT_TEXT_STYLE },
  }
}

function openWith(...layers: (RasterLayerEntry | TextLayerEntry | GroupLayerEntry)[]) {
  const project = useProjectStore()
  project.rootPath = '/root'
  project.allFiles = [
    {
      pageId: PAGE_ID,
      pageDir: `/root/shashoku/pages/${PAGE_ID}`,
      page: defaultManifest('source', PAGE.w, PAGE.h),
      ocr: defaultOcr(PAGE.w, PAGE.h),
      badge: 'ok',
    },
  ]
  for (const layer of layers) project.addLayer(PAGE_ID, layer)
  const editor = useEditorStore()
  editor.currentPageId = PAGE_ID
  return { project, editor }
}

function selectSomething() {
  useSelectionStore().applyShape(PAGE, rasterizeRect(PAGE, { x: 10, y: 10, w: 20, h: 20 }), 'new', 'test')
}

beforeAll(() => {
  vi.stubGlobal('window', { engine })
})

beforeEach(() => {
  engine.maskReset()
  setActivePinia(createPinia())
})

/**
 * Delete has to answer to two things at once, and which one it means is decided
 * by the situation rather than by a modifier — Photoshop's answer to the same
 * collision, and the reason the layer panel grew a button of its own.
 */
describe('which of the two things Delete means', () => {
  it('takes the layer away when there is nothing selected on it', () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    expect(useSelectionPixels().erasesPixels.value).toBe(false)
  })

  it('takes the pixels out when a selection is over a raster layer', () => {
    const { editor } = openWith(raster('r'))
    selectSomething()
    editor.selectOnly('r')
    expect(useSelectionPixels().erasesPixels.value).toBe(true)
  })

  it('takes the layer away when what is selected holds no pixels', () => {
    const { editor } = openWith(text('t'))
    selectSomething()
    editor.selectOnly('t')
    expect(useSelectionPixels().erasesPixels.value).toBe(false)
  })

  /**
   * Deliberately claimed even by a layer that will refuse the write. What a key
   * means is not settled by whether it succeeds, and a Delete that quietly took
   * the whole layer instead would be the worst possible answer to a lock.
   */
  it('still means the pixels when the layer is locked', () => {
    const { editor } = openWith(raster('r', { locked: true }))
    selectSomething()
    editor.selectOnly('r')
    expect(useSelectionPixels().erasesPixels.value).toBe(true)
  })
})

describe('erasing what is inside the selection', () => {
  it('names the locked layer it will not write to', async () => {
    const { editor, project } = openWith(raster('r', { name: '底圖', locked: true }))
    selectSomething()
    editor.selectOnly('r')

    await useSelectionPixels().eraseSelection()

    expect(useNoticeStore().notice?.text).toBe('「底圖」鎖定中，改不了')
    expect(project.entryById('r')).toMatchObject({ file: 'r.png' })
  })

  it('names the hidden layer it will not write to', async () => {
    const { editor } = openWith(raster('r', { name: '塗白', visible: false }))
    selectSomething()
    editor.selectOnly('r')

    await useSelectionPixels().eraseSelection()

    expect(useNoticeStore().notice?.text).toBe('「塗白」是隱藏的，改不了')
  })

  it('does nothing at all with no selection to erase', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')

    await useSelectionPixels().eraseSelection()

    // Silent rather than a notice: Delete is not claimed here, so the key went
    // to deleting the layer and there is nothing to explain.
    expect(useNoticeStore().notice).toBeNull()
  })
})

// The two exits differ in what they ask of storage — a lift only reads its
// source — but they agree entirely on who is allowed near the layer.
describe('lifting what is inside the selection', () => {
  it('goes with the selection rather than the whole layer', () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')
    const pixels = useSelectionPixels()
    expect(pixels.liftsSelection.value).toBe(false)

    selectSomething()
    expect(pixels.liftsSelection.value).toBe(true)
  })

  it('refuses the same layers the erase does', async () => {
    const { editor } = openWith(raster('r', { name: '底圖', locked: true }))
    selectSomething()
    editor.selectOnly('r')

    await useSelectionPixels().liftSelection()

    expect(useNoticeStore().notice?.text).toBe('「底圖」鎖定中，改不了')
    expect(editor.canRedo).toBe(false)
  })

  // A layer nothing has been painted on has no frame, so there is nothing under
  // the selection to lift out of it.
  it('has nothing to lift from a layer with no frame', async () => {
    const { editor, project } = openWith(raster('r', { w: 0, h: 0 }))
    selectSomething()
    editor.selectOnly('r')

    await useSelectionPixels().liftSelection()

    expect(project.pageById(PAGE_ID)?.page.layers).toHaveLength(1)
  })
})
