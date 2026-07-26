import { describe, expect, it } from 'vitest'
import {
  centeredBoxOnScreen,
  contentToScreenPx,
  screenToContentPx,
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
