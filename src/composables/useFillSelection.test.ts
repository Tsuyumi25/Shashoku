import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { defaultManifest, defaultOcr } from '@shared/page/schema'
import type { GroupLayerEntry, RasterLayerEntry } from '@shared/page/types'
import { rasterizeRect } from '@/lib/selection/raster'
import { useFillSelection } from '@/composables/useFillSelection'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'

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

function folder(id: string, children: RasterLayerEntry[], extra: Partial<GroupLayerEntry> = {}): GroupLayerEntry {
  return {
    kind: 'group',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'pass-through',
    children,
    ...extra,
  }
}

/**
 * A page with one layer on it, open, with the cursor standing on that layer.
 *
 * Nothing here reaches disk or the engine: every refusal this file is about
 * answers before the layer would be handed over, which is the point of asking
 * them in that order.
 */
function openWith(...layers: (RasterLayerEntry | GroupLayerEntry)[]) {
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

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('what a fill needs before it can happen', () => {
  it('says so when there is no selection to fill', async () => {
    const { editor } = openWith(raster('r'))
    editor.selectOnly('r')

    await useFillSelection().fillSelection()

    expect(useNoticeStore().notice?.text).toBe('沒有選區可以填充')
    expect(editor.canUndo).toBe(false)
  })

  it('says so when nothing that takes pixels is selected', async () => {
    const { editor } = openWith(raster('r'))
    selectSomething()
    editor.selectOnly(null)

    await useFillSelection().fillSelection()

    expect(useNoticeStore().notice?.text).toBe('選一個點陣圖層再填充')
  })

  // A text object is selectable and is not somewhere paint can go.
  it('will not fill a layer that is not made of pixels', async () => {
    const { editor } = openWith(folder('g', []))
    selectSomething()
    editor.selectOnly('g')

    await useFillSelection().fillSelection()

    expect(useNoticeStore().notice?.text).toBe('選一個點陣圖層再填充')
  })

  it('is only ready when a raster layer and a selection are both there', () => {
    const { editor } = openWith(raster('r'))
    const { canFill } = useFillSelection()
    expect(canFill.value).toBe(false)

    selectSomething()
    expect(canFill.value).toBe(false)

    editor.selectOnly('r')
    expect(canFill.value).toBe(true)
  })
})

describe('layers a write is refused on', () => {
  it('names the locked layer it will not write to', async () => {
    const { editor, project } = openWith(raster('r', { name: '底圖', locked: true }))
    selectSomething()
    editor.selectOnly('r')

    await useFillSelection().fillSelection()

    expect(useNoticeStore().notice?.text).toBe('「底圖」鎖定中，改不了')
    expect(project.entryById('r')).toMatchObject({ file: 'r.png', x: 0, y: 0 })
  })

  // What gets protected by accident is the children, so the folder's lock has
  // to reach the fill the same way it reaches a drag.
  it('refuses a layer whose folder is locked', async () => {
    const { editor } = openWith(folder('g', [raster('r', { name: '補丁' })], { locked: true }))
    selectSomething()
    editor.selectOnly('r')

    await useFillSelection().fillSelection()

    expect(useNoticeStore().notice?.text).toBe('「補丁」鎖定中，改不了')
  })

  /**
   * Paint that lands where nothing shows it is indistinguishable from a tool
   * that is broken, so the refusal is the only honest answer.
   */
  it('names the hidden layer it will not write to', async () => {
    const { editor, project } = openWith(raster('r', { name: '塗白', visible: false }))
    selectSomething()
    editor.selectOnly('r')

    await useFillSelection().fillSelection()

    expect(useNoticeStore().notice?.text).toBe('「塗白」是隱藏的，改不了')
    expect(project.entryById('r')).toMatchObject({ file: 'r.png', x: 0, y: 0 })
  })

  it('refuses a layer whose folder is switched off', async () => {
    const { editor } = openWith(folder('g', [raster('r', { name: '塗白' })], { visible: false }))
    selectSomething()
    editor.selectOnly('r')

    await useFillSelection().fillSelection()

    expect(useNoticeStore().notice?.text).toBe('「塗白」是隱藏的，改不了')
  })

  // Locked is reported before hidden, so a layer that is both says the thing
  // somebody deliberately did rather than the thing they may have forgotten.
  it('reports the lock first when a layer is both', async () => {
    const { editor } = openWith(raster('r', { name: '底圖', locked: true, visible: false }))
    selectSomething()
    editor.selectOnly('r')

    await useFillSelection().fillSelection()

    expect(useNoticeStore().notice?.text).toBe('「底圖」鎖定中，改不了')
  })
})
