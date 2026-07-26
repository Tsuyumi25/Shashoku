import { describe, expect, it } from 'vitest'
import { contentToScreenPx, screenToContentPx } from '@/lib/coords'
import { useZoomPan } from './useZoomPan'

const CONTAINER = { w: 800, h: 600 }
const CONTENT = { w: 400, h: 300 }
const ORIGIN = { left: 0, top: 0 }

describe('useZoomPan.rotateTo', () => {
  it('keeps the content under the pivot fixed across rotations', () => {
    const { view, fitToView, rotateTo } = useZoomPan(
      () => CONTAINER,
      () => CONTENT,
    )
    fitToView()
    const pivot = { x: CONTAINER.w / 2, y: CONTAINER.h / 2 }
    const before = screenToContentPx(pivot.x, pivot.y, ORIGIN, view)

    rotateTo(Math.PI / 5, pivot.x, pivot.y)
    const after = screenToContentPx(pivot.x, pivot.y, ORIGIN, view)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
    expect(view.rotate).toBeCloseTo(Math.PI / 5, 9)

    rotateTo(-Math.PI / 3, pivot.x, pivot.y)
    const again = screenToContentPx(pivot.x, pivot.y, ORIGIN, view)
    expect(again.x).toBeCloseTo(before.x, 6)
    expect(again.y).toBeCloseTo(before.y, 6)
  })

  it('lands the pivot content back on the pivot after rotating to 0', () => {
    const { view, fitToView, rotateTo } = useZoomPan(
      () => CONTAINER,
      () => CONTENT,
    )
    fitToView()
    const pivot = { x: 123, y: 456 }
    const c = screenToContentPx(pivot.x, pivot.y, ORIGIN, view)
    rotateTo(1.1, pivot.x, pivot.y)
    rotateTo(0, pivot.x, pivot.y)
    const s = contentToScreenPx(c.x, c.y, view)
    expect(s.x).toBeCloseTo(pivot.x, 6)
    expect(s.y).toBeCloseTo(pivot.y, 6)
    expect(view.rotate).toBe(0)
  })
})

describe('useZoomPan.fitToView', () => {
  it('centres the content and clears rotation', () => {
    const { view, fitToView } = useZoomPan(
      () => CONTAINER,
      () => CONTENT,
    )
    view.rotate = 1
    expect(fitToView()).toBe(true)
    expect(view.scale).toBeCloseTo(2, 9)
    expect(view.rotate).toBe(0)
    expect(view.tx).toBeCloseTo(0, 9)
    expect(view.ty).toBeCloseTo(0, 9)
  })

  it('leaves the view untouched while the container has no size', () => {
    const { view, fitToView } = useZoomPan(
      () => ({ w: 0, h: 0 }),
      () => CONTENT,
    )
    expect(fitToView()).toBe(false)
    expect(view).toEqual({ scale: 1, tx: 0, ty: 0, rotate: 0 })
  })
})

describe('useZoomPan.zoomBy', () => {
  it('anchors on the container centre', () => {
    const { view, fitToView, zoomBy } = useZoomPan(
      () => CONTAINER,
      () => CONTENT,
    )
    fitToView()
    const centre = { x: CONTAINER.w / 2, y: CONTAINER.h / 2 }
    const before = screenToContentPx(centre.x, centre.y, ORIGIN, view)
    zoomBy(1.25)
    const after = screenToContentPx(centre.x, centre.y, ORIGIN, view)
    expect(view.scale).toBeCloseTo(2.5, 9)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('clamps zooming out at half the fit scale', () => {
    const { view, fitToView, zoomBy } = useZoomPan(
      () => CONTAINER,
      () => CONTENT,
    )
    fitToView()
    zoomBy(0.01)
    expect(view.scale).toBeCloseTo(1, 9)
  })
})

describe('useZoomPan.panBy', () => {
  it('translates in screen px regardless of rotation', () => {
    const { view, fitToView, rotateTo, panBy } = useZoomPan(
      () => CONTAINER,
      () => CONTENT,
    )
    fitToView()
    rotateTo(Math.PI / 3, 0, 0)
    const tx = view.tx
    const ty = view.ty
    panBy(30, -12)
    expect(view.tx).toBeCloseTo(tx + 30, 9)
    expect(view.ty).toBeCloseTo(ty - 12, 9)
  })
})
