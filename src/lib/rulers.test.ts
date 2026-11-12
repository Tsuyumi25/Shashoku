import { describe, expect, it } from 'vitest'
import { useZoomPan } from '@/composables/useZoomPan'
import { levelView, linesOfBox, linesOfGuides, nearestWithin, rulerSteps, smartSegments, snapBox } from '@/lib/rulers'

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

describe('snapping a box onto lines', () => {
  const lines = linesOfGuides([
    { id: 'v', orientation: 'vertical', position: 100 },
    { id: 'h', orientation: 'horizontal', position: 50 },
  ])

  it('moves each axis on its own, by whichever of the edges and middle is nearest, and names the line it took', () => {
    // Left edge at 97 is 3 off the vertical line; the middle at 46 is 4 off the horizontal one.
    expect(snapBox({ x: 97, y: 36, w: 40, h: 20 }, lines, 8)).toEqual({ dx: 3, dy: 4, x: 100, y: 50 })
    // The right edge at 104 is nearer than the middle at 84.
    expect(snapBox({ x: 64, y: 0, w: 40, h: 10 }, lines, 8).dx).toBe(-4)
  })

  it('leaves an axis alone when no line on it is in reach', () => {
    expect(snapBox({ x: 120, y: 70, w: 10, h: 2 }, lines, 8)).toEqual({ dx: 0, dy: 0, x: null, y: null })
  })

  it('takes the edges and middle of another box as lines', () => {
    // A box whose top at 203 is 3 under the other's top at 200.
    const other = linesOfBox({ x: 0, y: 200, w: 50, h: 100 })
    expect(snapBox({ x: 300, y: 203, w: 20, h: 20 }, other, 8)).toMatchObject({ dy: -3, y: 200 })
  })
})

describe('the smart guide a held box shows', () => {
  const page = { w: 1000, h: 1400 }

  it('reaches from the box to the nearest other box sharing the line, and no further', () => {
    const moved = { x: 100, y: 500, w: 40, h: 60 }
    const far = { x: 100, y: 1200, w: 80, h: 50 }
    const near = { x: 100, y: 200, w: 30, h: 100 }
    // Both share the left edge at 100; the one above is 200 away, the one below 640.
    expect(smartSegments(moved, { x: 100, y: null }, [far, near], page)).toEqual([{ x1: 100, y1: 200, x2: 100, y2: 560 }])
  })

  it('crosses the page and stops at its edges for a line of the page itself', () => {
    const moved = { x: 480, y: 300, w: 40, h: 20 }
    expect(smartSegments(moved, { x: 500, y: null }, [], page)).toEqual([{ x1: 500, y1: 0, x2: 500, y2: 1400 }])
  })

  it('draws nothing for a line held to neither a box nor the page — a guide shows itself', () => {
    expect(smartSegments({ x: 0, y: 0, w: 10, h: 10 }, { x: 333, y: 444 }, [], page)).toEqual([])
  })
})
