import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { contentToScreenPx } from '@/lib/coords'
import { regionAt } from '@/lib/explode/partition'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import type { OcrCandidatePersisted } from '@shared/page/types'
import { emptyCounters } from '@shared/page/numbers'
import { treesFromOneTree } from '@shared/page/schema'
import { MAX_FACTOR, MIN_CAP, useExplodeStore, WHOLE_PAGE } from './explodeStore'
import { useEditorStore } from './editorStore'
import { useProjectStore } from './projectStore'

const PAGE_ID = 'p001.png'
const FACE = 'face-a'
const PAGE = { w: 1200, h: 1731 }
const ORIGIN = { left: 0, top: 0 }

/** A page of balloons, spread far enough apart to be cut into several pieces. */
const READ_AT = [
  { x: 95, y: 120, w: 150, h: 220 },
  { x: 820, y: 90, w: 180, h: 260 },
  { x: 140, y: 700, w: 220, h: 160 },
  { x: 900, y: 780, w: 160, h: 140 },
  { x: 180, y: 1180, w: 200, h: 180 },
  { x: 980, y: 1420, w: 150, h: 160 },
]

const candidates: OcrCandidatePersisted[] = READ_AT.map((box, i) => ({
  hash: `h${i}`,
  source: 'test',
  text: '',
  original: '',
  confidence: 1,
  label: 'text_bubble',
  ...box,
}))

function openPage() {
  const project = useProjectStore()
  project.projectMeta.faces = [{ id: FACE, no: 1, name: '譯文' }]
  project.projectMeta.activeFace = FACE
  project.allFiles = [
    {
      pageId: PAGE_ID,
      pageDir: `/x/${PAGE_ID}`,
      page: {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        revision: 0,
        name: 'p',
        width: PAGE.w,
        height: PAGE.h,
        ledgers: { [FACE]: { units: [] } },
        readingOrder: [],
        readingEdges: [],
        counters: emptyCounters(),
        ...treesFromOneTree([], [FACE], FACE),
      },
      ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: PAGE.w, height: PAGE.h, candidates },
      badge: 'ok',
    },
  ]
  const editor = useEditorStore()
  editor.currentPageId = PAGE_ID
  editor.viewContentSize = { w: PAGE.w, h: PAGE.h }
  editor.viewContainerSize = { w: 900, h: 700 }
  editor.view.scale = 0.4
  editor.view.tx = 37
  editor.view.ty = -12
  editor.view.rotate = 0
}

beforeEach(() => {
  setActivePinia(createPinia())
  openPage()
})

describe('useExplodeStore', () => {
  it('leaves the canvas exactly as it was while the page is whole', () => {
    const explode = useExplodeStore()
    const editor = useEditorStore()
    expect(explode.cap).toBe(1)
    expect(explode.exploded).toBe(false)
    expect(explode.partition).toBeNull()
    expect(explode.offsetOf(0)).toEqual({ x: 0, y: 0 })
    expect(explode.viewOf(0)).toBe(editor.view)
    expect(explode.regionAtPage({ x: 600, y: 900 })).toBe(WHOLE_PAGE)
    expect(explode.regionAtScreen(100, 100, ORIGIN)).toBe(WHOLE_PAGE)
  })

  it('stays whole at the top threshold, however far the pieces are pushed', () => {
    const explode = useExplodeStore()
    explode.setFactor(0.4)
    expect(explode.partition).toBeNull()
    expect(explode.exploded).toBe(false)
    expect(explode.offsetOf(0)).toEqual({ x: 0, y: 0 })
    expect(explode.regionAtScreen(100, 100, ORIGIN)).toBe(WHOLE_PAGE)
  })

  it('holds both numbers to the range the panel offers', () => {
    const explode = useExplodeStore()
    explode.setCap(0)
    expect(explode.cap).toBe(MIN_CAP)
    explode.setCap(4)
    expect(explode.cap).toBe(1)
    explode.setFactor(-1)
    expect(explode.factor).toBe(0)
    explode.setFactor(9)
    expect(explode.factor).toBe(MAX_FACTOR)
  })

  it('hands the view every piece where it stands to fit, and nothing while the page is whole', () => {
    const explode = useExplodeStore()
    const editor = useEditorStore()
    expect(editor.viewFitArea).toBeNull()
    explode.setCap(0.2)
    explode.setFactor(0.6)
    const area = editor.viewFitArea!
    explode.regions.forEach((region, at) => {
      const by = explode.offsetOf(at)
      for (const run of region.runs) {
        expect(run.x + by.x).toBeGreaterThanOrEqual(area.x)
        expect(run.y + by.y).toBeGreaterThanOrEqual(area.y)
        expect(run.x + run.w + by.x).toBeLessThanOrEqual(area.x + area.w)
        expect(run.y + run.h + by.y).toBeLessThanOrEqual(area.y + area.h)
      }
    })
    expect(area.w).toBeGreaterThan(PAGE.w)
    explode.setCap(1)
    expect(editor.viewFitArea).toBeNull()
  })

  it('pushes each piece out from the page centre by its own anchor', () => {
    const explode = useExplodeStore()
    explode.setCap(0.15)
    explode.setFactor(0.3)
    expect(explode.regions.length).toBeGreaterThan(1)
    explode.regions.forEach((region, r) => {
      expect(explode.offsetOf(r)).toEqual({
        x: (region.anchor.x - PAGE.w / 2) * 0.3,
        y: (region.anchor.y - PAGE.h / 2) * 0.3,
      })
    })
  })

  it('carries that travel in the view each piece speaks in', () => {
    const explode = useExplodeStore()
    const editor = useEditorStore()
    explode.setCap(0.15)
    explode.setFactor(0.3)
    explode.regions.forEach((_, r) => {
      const offset = explode.offsetOf(r)
      const view = explode.viewOf(r)
      expect(view.scale).toBe(editor.view.scale)
      expect(view.rotate).toBe(editor.view.rotate)
      expect(view.tx).toBeCloseTo(editor.view.tx + editor.view.scale * offset.x, 6)
      expect(view.ty).toBeCloseTo(editor.view.ty + editor.view.scale * offset.y, 6)
    })
  })

  it('reads a screen point back into the piece that is showing it', () => {
    const explode = useExplodeStore()
    explode.setCap(0.15)
    explode.setFactor(0.3)
    const cut = explode.partition
    expect(cut).not.toBeNull()
    expect(explode.regions.length).toBeGreaterThan(1)
    let asked = 0
    for (let r = 0; r < explode.regions.length; r++) {
      for (const run of explode.regions[r].runs) {
        const page = { x: run.x + run.w / 2, y: run.y + run.h / 2 }
        if (regionAt(cut!, page.x, page.y) !== r) continue
        const on = contentToScreenPx(page.x, page.y, explode.viewOf(r))
        expect(explode.regionAtScreen(on.x, on.y, ORIGIN)).toBe(r)
        const back = explode.pageAtScreen(on.x, on.y, ORIGIN, r)
        expect(back.x).toBeCloseTo(page.x, 6)
        expect(back.y).toBeCloseTo(page.y, 6)
        asked++
        break
      }
    }
    expect(asked).toBe(explode.regions.length)
  })

  it('shows no page at all beyond every piece', () => {
    const explode = useExplodeStore()
    const editor = useEditorStore()
    explode.setCap(0.15)
    explode.setFactor(0.3)
    const away = contentToScreenPx(-600, -600, editor.view)
    expect(explode.regionAtScreen(away.x, away.y, ORIGIN)).toBeNull()
  })

  it('draws a frame inside one piece once, and one across a boundary once per piece', () => {
    const explode = useExplodeStore()
    explode.setCap(0.15)
    explode.setFactor(0.3)
    const cut = explode.partition
    expect(cut).not.toBeNull()
    const inside = explode.regionsOfBox({ x: READ_AT[0].x, y: READ_AT[0].y, w: READ_AT[0].w, h: READ_AT[0].h })
    expect(inside).toHaveLength(1)
    expect(explode.clipOf(inside[0])).toMatch(/^path\("M/)
    const across = explode.regionsOfBox({ x: 0, y: 0, w: PAGE.w, h: PAGE.h })
    expect(across.length).toBe(explode.regions.length)
    expect(across[0]).toBe(explode.regionAtPage({ x: PAGE.w / 2, y: PAGE.h / 2 }))
  })

  it('leaves a frame off the page standing where the whole page would put it', () => {
    const explode = useExplodeStore()
    explode.setCap(0.15)
    explode.setFactor(0.3)
    expect(explode.regionsOfBox({ x: -500, y: -500, w: 50, h: 50 })).toEqual([WHOLE_PAGE])
    expect(explode.clipOf(WHOLE_PAGE)).toBeUndefined()
  })

  it('reads a dropped point back through the piece showing it, and off a gap onto the nearest', () => {
    const explode = useExplodeStore()
    explode.setCap(0.15)
    explode.setFactor(0.3)
    const cut = explode.partition
    expect(cut).not.toBeNull()
    expect(explode.regions.length).toBeGreaterThan(1)
    explode.regions.forEach((region, r) => {
      const offset = explode.offsetOf(r)
      for (const run of region.runs) {
        const page = { x: run.x + run.w / 2, y: run.y + run.h / 2 }
        if (regionAt(cut!, page.x, page.y) !== r) continue
        const landing = explode.landingAtShown({ x: page.x + offset.x, y: page.y + offset.y })
        expect(landing.region).toBe(r)
        expect(landing.point.x).toBeCloseTo(page.x, 9)
        expect(landing.point.y).toBeCloseTo(page.y, 9)
        break
      }
    })
    const editor = useEditorStore()
    let gaps = 0
    for (let x = 0; x < PAGE.w; x += 13)
      for (let y = 0; y < PAGE.h; y += 17) {
        const on = contentToScreenPx(x, y, editor.view)
        if (explode.regionAtScreen(on.x, on.y, ORIGIN) !== null) continue
        gaps++
        const landing = explode.landingAtShown({ x, y })
        // Pulled onto the piece it was given to: the page has no gap in it.
        expect(regionAt(cut!, landing.point.x, landing.point.y)).toBe(landing.region)
      }
    expect(gaps).toBeGreaterThan(0)
  })

  it('leaves a dropped point alone while the page is whole', () => {
    const explode = useExplodeStore()
    expect(explode.landingAtShown({ x: 300, y: 400 })).toEqual({
      region: WHOLE_PAGE,
      point: { x: 300, y: 400 },
    })
  })
})
