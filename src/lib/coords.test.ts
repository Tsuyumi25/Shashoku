import { describe, expect, it } from 'vitest'
import {
  centeredBoxOnScreen,
  contentToScreenPx,
  screenDeltaToContentPx,
  screenToContentPx,
  screenToPagePx,
  smoothingQualityFor,
  type ViewTransform,
} from './coords'

const ORIGIN = { left: 0, top: 0 }

describe('coords with view rotation', () => {
  it('screenToContentPx inverts contentToScreenPx, rotation included', () => {
    const view: ViewTransform = { scale: 1.7, tx: 120, ty: -40, rotate: Math.PI / 7 }
    const p = { x: 333, y: 218 }
    const s = contentToScreenPx(p.x, p.y, view)
    const back = screenToContentPx(s.x, s.y, ORIGIN, view)
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })

  it('degenerates to plain translate + scale when rotate is 0', () => {
    const view: ViewTransform = { scale: 2, tx: 10, ty: 20, rotate: 0 }
    expect(screenToContentPx(30, 60, ORIGIN, view)).toEqual({ x: 10, y: 20 })
    expect(contentToScreenPx(10, 20, view)).toEqual({ x: 30, y: 60 })
  })

  it('maps the content +x axis onto the screen +y axis at 90 degrees', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: Math.PI / 2 }
    const s = contentToScreenPx(10, 0, view)
    expect(s.x).toBeCloseTo(0, 6)
    expect(s.y).toBeCloseTo(10, 6)
  })
})

describe('screenDeltaToContentPx', () => {
  it('divides by the scale and ignores the translation', () => {
    const view: ViewTransform = { scale: 2, tx: 999, ty: -999, rotate: 0 }
    expect(screenDeltaToContentPx(10, 20, view)).toEqual({ x: 5, y: 10 })
  })

  it('turns a downward drag into content +x at 90 degrees', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: Math.PI / 2 }
    const d = screenDeltaToContentPx(0, 10, view)
    expect(d.x).toBeCloseTo(10, 6)
    expect(d.y).toBeCloseTo(0, 6)
  })

  it('agrees with the difference of two mapped points', () => {
    const view: ViewTransform = { scale: 1.7, tx: 120, ty: -40, rotate: Math.PI / 7 }
    const at = { x: 300, y: 200 }
    const drag = { x: 37, y: -22 }
    const before = screenToContentPx(at.x, at.y, ORIGIN, view)
    const after = screenToContentPx(at.x + drag.x, at.y + drag.y, ORIGIN, view)
    const d = screenDeltaToContentPx(drag.x, drag.y, view)
    expect(d.x).toBeCloseTo(after.x - before.x, 6)
    expect(d.y).toBeCloseTo(after.y - before.y, 6)
  })
})

describe('screenToPagePx', () => {
  const NATURAL = { w: 400, h: 200 }

  it('reads a screen point as the page pixel it landed on', () => {
    const view: ViewTransform = { scale: 2, tx: 50, ty: -30, rotate: 0 }
    const s = contentToScreenPx(100, 150, view)
    expect(screenToPagePx(s.x, s.y, ORIGIN, view, NATURAL)).toEqual({ x: 100, y: 150 })
  })

  it('keeps a point between two pixels, which is where a person may put one', () => {
    const view: ViewTransform = { scale: 4, tx: 0, ty: 0, rotate: 0 }
    expect(screenToPagePx(50, 130, ORIGIN, view, NATURAL)).toEqual({ x: 12.5, y: 32.5 })
  })

  it('subtracts the container offset like screenToContentPx does', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: 0 }
    const rect = { left: 60, top: 20 }
    expect(screenToPagePx(260, 120, rect, view, NATURAL)).toEqual({ x: 200, y: 100 })
  })

  it('clamps a point off the page to its edge', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: 0 }
    expect(screenToPagePx(-500, -500, ORIGIN, view, NATURAL)).toEqual({ x: 0, y: 0 })
    expect(screenToPagePx(9999, 9999, ORIGIN, view, NATURAL)).toEqual({ x: 400, y: 200 })
  })

  it('follows the view rotation', () => {
    const view: ViewTransform = { scale: 1.3, tx: 17, ty: -44, rotate: Math.PI / 5 }
    const s = contentToScreenPx(300, 50, view)
    const p = screenToPagePx(s.x, s.y, ORIGIN, view, NATURAL)
    expect(p.x).toBeCloseTo(300, 6)
    expect(p.y).toBeCloseTo(50, 6)
  })
})

describe('smoothingQualityFor', () => {
  it('pays for the good filter going down, which is where it is the one that helps', () => {
    expect(smoothingQualityFor(0.25)).toBe('high')
    expect(smoothingQualityFor(0.99)).toBe('high')
  })

  /**
   * The boundary the two draw sites used to disagree about. A ratio of exactly
   * 1 is 100% zoom at dpr 1 and renderScale 1 — the one moment a person can
   * hold the preview and the export side by side.
   */
  it('keeps the good filter at exactly one', () => {
    expect(smoothingQualityFor(1)).toBe('high')
  })

  it('stops paying going up, where the two filters agree anyway', () => {
    expect(smoothingQualityFor(1.5)).toBe('low')
    expect(smoothingQualityFor(8)).toBe('low')
  })
})

describe('centeredBoxOnScreen', () => {
  it('puts the centre where the view puts the anchor and scales the box with it', () => {
    const view: ViewTransform = { scale: 2, tx: 10, ty: 20, rotate: 0 }
    const box = centeredBoxOnScreen({ x: 100, y: 50 }, { w: 40, h: 20 }, view)
    expect(box).toEqual({ centerX: 210, centerY: 120, width: 80, height: 40 })
  })

  it('keeps the box axis aligned under rotation, moving only its centre', () => {
    const view: ViewTransform = { scale: 3, tx: 0, ty: 0, rotate: Math.PI / 2 }
    const box = centeredBoxOnScreen({ x: 10, y: 0 }, { w: 8, h: 4 }, view)
    expect(box.centerX).toBeCloseTo(0, 6)
    expect(box.centerY).toBeCloseTo(30, 6)
    expect(box.width).toBe(24)
    expect(box.height).toBe(12)
  })
})
