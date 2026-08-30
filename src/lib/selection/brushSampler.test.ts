import { describe, expect, it } from 'vitest'
import {
  createBrushSampler,
  DEFAULT_BRUSH_SPACING_RATIO,
  type BrushSample,
  type Dab,
} from '@/lib/selection/brushSampler'

const sample = (x: number, y: number, pressure = 1, time = 0): BrushSample => ({
  x,
  y,
  pressure,
  time,
})

const dist = (a: Dab, b: Dab): number => Math.hypot(a.x - b.x, a.y - b.y)

describe('createBrushSampler', () => {
  it('needs neither a store, a canvas, nor an engine to run', () => {
    const sampler = createBrushSampler({ radius: 10, opacity: 1 })
    const dabs = sampler.begin(sample(0, 0))
    expect(dabs).toHaveLength(1)
    expect(dabs[0]).toEqual({ x: 0, y: 0, radius: 10, opacity: 1 })
  })

  it('spaces at a quarter of the radius, matching the pre-existing constant', () => {
    // radius 20 -> spacing = diameter(40) * 0.125 = 5, i.e. radius * 0.25.
    const sampler = createBrushSampler({ radius: 20, opacity: 1 })
    sampler.begin(sample(0, 0))

    expect(sampler.push([sample(4.99, 0)])).toHaveLength(0)
    expect(sampler.push([sample(5.01, 0)])).toHaveLength(1)
  })

  it('floors spacing at one pixel for a small brush', () => {
    const sampler = createBrushSampler({ radius: 1, opacity: 1 })
    sampler.begin(sample(0, 0))

    // diameter(2) * 0.125 = 0.25, which the floor raises to 1.
    expect(sampler.push([sample(0.99, 0)])).toHaveLength(0)
    expect(sampler.push([sample(1.01, 0)])).toHaveLength(1)
  })

  it('recomputes spacing from each dab it just placed', () => {
    const sampler = createBrushSampler({ radius: 8, opacity: 1 })
    sampler.begin(sample(0, 0))
    // spacing = 8 * 0.25 = 2, so a run of 10 places dabs at 2,4,6,8,10.
    const dabs = sampler.push([sample(10, 0)])
    expect(dabs.map((d) => d.x)).toEqual([2, 4, 6, 8, 10])
  })

  describe('two segments joined end to end vs. one segment of the same length', () => {
    it('produce the same dab count', () => {
      const whole = createBrushSampler({ radius: 12, opacity: 1 })
      whole.begin(sample(0, 0))
      const wholeDabs = whole.push([sample(37, 0)])

      const split = createBrushSampler({ radius: 12, opacity: 1 })
      split.begin(sample(0, 0))
      const firstHalf = split.push([sample(19, 0)])
      const secondHalf = split.push([sample(37, 0)])

      expect(firstHalf.length + secondHalf.length).toBe(wholeDabs.length)
    })

    it('land dabs at the same positions regardless of where the split fell', () => {
      const whole = createBrushSampler({ radius: 12, opacity: 1 })
      whole.begin(sample(10, 10))
      const wholeDabs = whole.push([sample(10 + 43, 10)])

      const split = createBrushSampler({ radius: 12, opacity: 1 })
      split.begin(sample(10, 10))
      const dabs = [
        ...split.push([sample(10 + 5, 10)]),
        ...split.push([sample(10 + 5.3, 10)]),
        ...split.push([sample(10 + 21, 10)]),
        ...split.push([sample(10 + 43, 10)]),
      ]

      expect(dabs.map((d) => Math.round(d.x * 1e6))).toEqual(
        wholeDabs.map((d) => Math.round(d.x * 1e6)),
      )
    })
  })

  it('never places consecutive dabs further apart than the configured spacing, whatever the split', () => {
    const shape = { radius: 15, opacity: 1 }
    const spacing = 15 * 2 * DEFAULT_BRUSH_SPACING_RATIO
    // An L-shaped path: consecutive dabs across the corner are a chord of the
    // spacing arc, so this also exercises the "at most" half of the claim.
    const path = [sample(0, 0), sample(60, 0), sample(60, 33), sample(21, 33)]
    const splits: BrushSample[][] = [
      path.slice(1),
      // Same path, walked one point at a time via interpolated midpoints.
      path.slice(1).flatMap((to, i) => {
        const from = path[i]
        return [0.3, 0.6, 1].map((t) => sample(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t))
      }),
    ]

    for (const samples of splits) {
      const sampler = createBrushSampler(shape)
      const dabs = [...sampler.begin(path[0]), ...sampler.push(samples)]
      for (let i = 1; i < dabs.length; i++) {
        expect(dist(dabs[i - 1], dabs[i])).toBeLessThanOrEqual(spacing + 1e-9)
      }
    }
  })

  it('produces no extra dab for a zero-length sample, and leaves the residual untouched', () => {
    const withZero = createBrushSampler({ radius: 12, opacity: 1 })
    withZero.begin(sample(0, 0))
    const zero = withZero.push([sample(0, 0)])
    const afterZero = withZero.push([sample(37, 0)])

    const withoutZero = createBrushSampler({ radius: 12, opacity: 1 })
    withoutZero.begin(sample(0, 0))
    const withoutZeroDabs = withoutZero.push([sample(37, 0)])

    expect(zero).toHaveLength(0)
    expect(afterZero).toEqual(withoutZeroDabs)
  })

  it('does not force a dab onto the exact end of a push when residual distance remains', () => {
    // spacing = 8 * 0.25 = 2; 37 is not a multiple of 2.
    const sampler = createBrushSampler({ radius: 8, opacity: 1 })
    sampler.begin(sample(0, 0))
    const dabs = sampler.push([sample(37, 0)])

    expect(dabs[dabs.length - 1].x).toBeLessThan(37)
  })

  it('does not force a dab onto the exact end of `end` either', () => {
    const sampler = createBrushSampler({ radius: 8, opacity: 1 })
    sampler.begin(sample(0, 0))
    const dabs = sampler.end(sample(37, 0))

    expect(dabs[dabs.length - 1].x).toBeLessThan(37)
  })

  it('carries residual distance across an `end` the same way it does across `push`', () => {
    const sampler = createBrushSampler({ radius: 8, opacity: 1 })
    sampler.begin(sample(0, 0))
    sampler.push([sample(9, 0)])
    const ended = sampler.end(sample(11, 0))

    // spacing is 2; 9 leaves a residual of 1, so the next dab at 10 needs
    // only 1 more unit of travel rather than a fresh 2.
    expect(ended.map((d) => d.x)).toEqual([10])
  })

  it('ignores pressure for radius and opacity in this ticket', () => {
    const sampler = createBrushSampler({ radius: 8, opacity: 0.6 })
    sampler.begin(sample(0, 0, 0.1))
    const dabs = sampler.push([sample(20, 0, 0.9)])

    for (const dab of dabs) {
      expect(dab.radius).toBe(8)
      expect(dab.opacity).toBe(0.6)
    }
  })
})
