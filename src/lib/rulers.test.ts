import { describe, expect, it } from 'vitest'
import { useZoomPan } from '@/composables/useZoomPan'
import { levelView, nearestWithin, rulerSteps } from '@/lib/rulers'

describe('the view the rulers measure with', () => {
  const container = { w: 800, h: 600 }

  it('stays put while the view turns about the middle, and is the view itself when upright', () => {
    const { view, fitToView, rotateTo, panBy, zoomBy } = useZoomPan(container, { w: 1000, h: 1400 })
    fitToView()
    panBy(37, -12)
    zoomBy(1.7)
    const upright = { ...view }
    expect(levelView(view, container)).toEqual(upright)
    for (const turn of [0.3, 1.2, -2.5, Math.PI]) {
      rotateTo(turn, container.w / 2, container.h / 2)
      const level = levelView(view, container)
      expect(level.rotate).toBe(0)
      expect(level.scale).toBeCloseTo(upright.scale)
      expect(level.tx).toBeCloseTo(upright.tx)
      expect(level.ty).toBeCloseTo(upright.ty)
    }
  })
})

describe('ruler ticks', () => {
  it('numbers ticks at least sixty screen pixels apart on a 1-2-5 ladder', () => {
    expect(rulerSteps(1)).toEqual({ major: 100, minor: 10 })
    expect(rulerSteps(0.25)).toEqual({ major: 500, minor: 50 })
    expect(rulerSteps(3).major).toBe(20)
  })
})

describe('the nearest target in reach', () => {
  it('takes the nearest within reach and nothing beyond it', () => {
    expect(nearestWithin(103, [0, 100, 108], 8)).toBe(100)
    expect(nearestWithin(50, [0, 100], 8)).toBeNull()
  })
})
