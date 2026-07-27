import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { angleDelta, labelBoxSize, uniformScaleRatio } from './labelBox'

function styleWith(patch: Partial<TextStyle>): TextStyle {
  return { ...DEFAULT_TEXT_STYLE, ...patch }
}

describe('labelBoxSize', () => {
  it('measures a bitmap back down to document pixels', () => {
    const style = styleWith({ renderScale: 4 })
    expect(labelBoxSize(style, { width: 200, height: 80 })).toEqual({ w: 50, h: 20 })
  })

  it('leaves the bitmap alone at renderScale 1', () => {
    const style = styleWith({ renderScale: 1 })
    expect(labelBoxSize(style, { width: 37, height: 19 })).toEqual({ w: 37, h: 19 })
  })

  it('falls back to a one-line square when there is no bitmap to measure', () => {
    const style = styleWith({ fontSizePx: 30, leadingPercent: 120, renderScale: 4 })
    expect(labelBoxSize(style, null)).toEqual({ w: 36, h: 36 })
  })

  it('keeps the fallback in document pixels, so renderScale cannot reach it', () => {
    const at1 = labelBoxSize(styleWith({ fontSizePx: 24, renderScale: 1 }), null)
    const at8 = labelBoxSize(styleWith({ fontSizePx: 24, renderScale: 8 }), null)
    expect(at8).toEqual(at1)
  })
})

describe('uniformScaleRatio', () => {
  const CENTER = { x: 100, y: 100 }

  it('starts at exactly 1, so grabbing off-corner does not jump', () => {
    expect(uniformScaleRatio(CENTER, { x: 140, y: 130 }, { x: 140, y: 130 })).toBe(1)
  })

  it('doubles when the pointer moves twice as far out', () => {
    expect(uniformScaleRatio(CENTER, { x: 130, y: 140 }, { x: 160, y: 180 })).toBeCloseTo(2, 6)
  })

  it('halves on the way in', () => {
    expect(uniformScaleRatio(CENTER, { x: 100, y: 140 }, { x: 100, y: 120 })).toBeCloseTo(0.5, 6)
  })

  it('reads only the distance, so sliding along the circle changes nothing', () => {
    const r = uniformScaleRatio(CENTER, { x: 150, y: 100 }, { x: 100, y: 150 })
    expect(r).toBeCloseTo(1, 6)
  })

  it('holds at 1 when the drag began on the centre, where there is no distance to scale', () => {
    expect(uniformScaleRatio(CENTER, CENTER, { x: 180, y: 180 })).toBe(1)
  })
})

describe('angleDelta', () => {
  it('reports the plain difference well inside the range', () => {
    expect(angleDelta(0.2, 0.5)).toBeCloseTo(0.3, 9)
  })

  it('takes the short way round the seam instead of nearly a full turn back', () => {
    expect(angleDelta(3.1, -3.1)).toBeCloseTo(2 * Math.PI - 6.2, 9)
    expect(angleDelta(-3.1, 3.1)).toBeCloseTo(6.2 - 2 * Math.PI, 9)
  })

  it('folds an input that already ran several turns past the seam', () => {
    expect(angleDelta(0, 4 * Math.PI + 0.4)).toBeCloseTo(0.4, 9)
  })

  it('accumulates a full turn when a drag is followed step by step', () => {
    let last = 0
    let total = 0
    for (let i = 1; i <= 16; i++) {
      const now = (i * 2 * Math.PI) / 16
      total += angleDelta(last, now)
      last = now
    }
    expect(total).toBeCloseTo(2 * Math.PI, 6)
  })
})
