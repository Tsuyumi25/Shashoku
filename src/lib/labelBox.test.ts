import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { angleDelta, labelBoxSize, placeLabel, uniformScaleRatio } from './labelBox'

function styleWith(patch: Partial<TextStyle>): TextStyle {
  return { ...DEFAULT_TEXT_STYLE, ...patch }
}

describe('labelBoxSize', () => {
  it('takes the bitmap as the frame, a bitmap pixel being a document pixel', () => {
    expect(labelBoxSize(styleWith({}), { width: 37, height: 19 })).toEqual({ w: 37, h: 19 })
  })

  it('falls back to a one-line square when there is no bitmap to measure', () => {
    const style = styleWith({ fontSizePx: 30, leadingPercent: 120 })
    expect(labelBoxSize(style, null)).toEqual({ w: 36, h: 36 })
  })
})

describe('placeLabel', () => {
  const BOX = { w: 40, h: 20 }

  /** Where the bitmap's top left actually lands, which is the whole point. */
  const corner = (anchor: { x: number; y: number }, box = BOX) => {
    const p = placeLabel(anchor, box)
    return { x: p.center.x - box.w / 2, y: p.center.y - box.h / 2 }
  }

  it('lands the drawn corner on whole page pixels', () => {
    for (const at of [0, 0.1, 0.5, 0.9, 7.37, 512.62]) {
      const c = corner({ x: at, y: at })
      expect(Number.isInteger(c.x)).toBe(true)
      expect(Number.isInteger(c.y)).toBe(true)
    }
  })

  // On the axis that keeps its fraction, nothing is thrown away: what the grid
  // cannot hold is exactly what the rasterizer is handed.
  it('splits the free axis without losing any of it', () => {
    for (const x of [100.25, 100.5, 100.75, 512.25]) {
      const p = placeLabel({ x, y: 60 }, BOX)
      expect(p.center.x + p.phase.x).toBeCloseTo(x, 9)
    }
  })

  it('has nothing to correct when the corner is already whole', () => {
    const p = placeLabel({ x: 100, y: 60 }, BOX)
    expect(p).toEqual({ center: { x: 100, y: 60 }, phase: { x: 0, y: 0 } })
  })

  it('halves an odd box onto the corner rather than onto the stored position', () => {
    // 100 - 41/2 is 79.5: a whole centre still leaves the corner on a half.
    const p = placeLabel({ x: 100, y: 60 }, { w: 41, h: 20 })
    expect(p.center.x - 41 / 2).toBe(79)
    expect(p.phase.x).toBe(0.5)
  })

  it('keeps the horizontal fraction, so spacing stays where it was put', () => {
    expect(placeLabel({ x: 100.25, y: 60 }, BOX).phase.x).toBe(0.25)
    expect(placeLabel({ x: 100.75, y: 60 }, BOX).phase.x).toBe(0.75)
  })

  /**
   * The strokes a horizontal snap keeps crisp are everywhere in Chinese and
   * Japanese, which is why the two axes are quantised differently at all.
   */
  it('puts the baseline on the grid, so horizontal strokes stay sharp', () => {
    for (const y of [60.1, 60.4, 60.5, 60.9]) {
      expect(placeLabel({ x: 100, y }, BOX).phase.y).toBe(0)
    }
  })

  it('rounds the vertical rather than dropping it, so nothing drifts downward', () => {
    expect(corner({ x: 100, y: 60.4 }).y).toBe(50)
    expect(corner({ x: 100, y: 60.6 }).y).toBe(51)
  })

  it('quantises the phase, so a drag cannot rasterize afresh on every frame', () => {
    const phases = new Set<number>()
    for (let i = 0; i < 200; i++) phases.add(placeLabel({ x: 100 + i / 200, y: 0 }, BOX).phase.x)
    expect(phases.size).toBeLessThanOrEqual(4)
  })

  /**
   * Snapping one axis keeps the strokes that lie along it whole. Which axis
   * that is was never a property of the page — it was a property of the text
   * lying flat on it, so it has to follow the object round.
   */
  describe('the snapped axis follows the object round', () => {
    const QUARTER = Math.PI / 2
    /** Both axes land on a quarter, so a zero is evidence of snapping. */
    const AT = { x: 100.25, y: 60.25 }

    it('snaps Y upright, where horizontal strokes lie along a row', () => {
      const p = placeLabel(AT, BOX, 0)
      expect(p.phase).toEqual({ x: 0.25, y: 0 })
    })

    it('snaps Y at a half turn, which leaves them lying along a row', () => {
      const p = placeLabel(AT, BOX, Math.PI)
      expect(p.phase).toEqual({ x: 0.25, y: 0 })
    })

    it('snaps X at a quarter turn, which stands them up into a column', () => {
      const p = placeLabel(AT, BOX, QUARTER)
      expect(p.phase).toEqual({ x: 0, y: 0.25 })
    })

    it('snaps X at three quarters too, the column being what matters', () => {
      const p = placeLabel(AT, BOX, 3 * QUARTER)
      expect(p.phase).toEqual({ x: 0, y: 0.25 })
    })

    it('snaps neither off the axes, where the strokes align with nothing', () => {
      const p = placeLabel(AT, BOX, Math.PI / 4)
      expect(p.phase).toEqual({ x: 0.25, y: 0.25 })
    })

    it('reads a negative turn the same way, since an axis has no direction', () => {
      const p = placeLabel(AT, BOX, -QUARTER)
      expect(p.phase).toEqual({ x: 0, y: 0.25 })
    })

    it('does not call a near-miss a right angle', () => {
      // A degree off is a degree of strokes crossing the grid, which is what
      // snapping the wrong axis would bake in.
      const p = placeLabel(AT, BOX, QUARTER - 0.02)
      expect(p.phase).toEqual({ x: 0.25, y: 0.25 })
    })
  })

  it('works to the left of the page origin, where flooring and truncating differ', () => {
    const c = corner({ x: -0.3, y: -0.3 })
    expect(Number.isInteger(c.x)).toBe(true)
    expect(placeLabel({ x: -0.3, y: 0 }, BOX).phase.x).toBeGreaterThanOrEqual(0)
    expect(placeLabel({ x: -0.3, y: 0 }, BOX).phase.x).toBeLessThan(1)
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
