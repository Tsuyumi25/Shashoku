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

  /**
   * `getCoalescedEvents()` can hand back on the order of 240 points a
   * second against one frame a moment. The residual distance is what stops
   * that from multiplying the dab count — this pins the claim at the sizes
   * a brush actually ships at, one batched `push` against the same samples
   * fed one at a time.
   */
  it.each([20, 50, 100, 250])(
    'radius %d: a batch of samples produces as many dabs as the same samples delivered one at a time',
    (radius) => {
      const length = 1000
      const points = Array.from({ length }, (_, i) => sample(i + 1, 0))

      const batched = createBrushSampler({ radius, opacity: 1 })
      batched.begin(sample(0, 0))
      const batchDabs = batched.push(points)

      const perSample = createBrushSampler({ radius, opacity: 1 })
      perSample.begin(sample(0, 0))
      let perSampleCount = 0
      for (const point of points) perSampleCount += perSample.push([point]).length

      expect(batchDabs.length).toBe(perSampleCount)
    },
  )

  it('never lets pressure touch opacity', () => {
    const sampler = createBrushSampler({ radius: 8, opacity: 0.6 })
    sampler.begin(sample(0, 0, 0.1))
    const dabs = sampler.push([sample(20, 0, 0.9)])

    for (const dab of dabs) {
      expect(dab.opacity).toBe(0.6)
    }
  })

  describe('pressure driving radius', () => {
    it('scales a dab radius by the sample pressure it was placed at', () => {
      const sampler = createBrushSampler({ radius: 20, opacity: 1 })
      const [dab] = sampler.begin(sample(0, 0, 0.5))

      expect(dab.radius).toBe(10)
    })

    it('does not let dab radius decrease while sample pressure rises monotonically', () => {
      const sampler = createBrushSampler({ radius: 20, opacity: 1 })
      const dabs = [
        ...sampler.begin(sample(0, 0, 0.1)),
        ...sampler.push([
          sample(30, 0, 0.3),
          sample(60, 0, 0.5),
          sample(90, 0, 0.7),
          sample(120, 0, 1),
        ]),
      ]

      for (let i = 1; i < dabs.length; i++) {
        expect(dabs[i].radius).toBeGreaterThanOrEqual(dabs[i - 1].radius)
      }
    })

    it('holds the last valid pressure for a dab where a sample in the middle reports 0', () => {
      const sampler = createBrushSampler({ radius: 20, opacity: 1 })
      sampler.begin(sample(0, 0, 0.8))
      const dabs = sampler.push([sample(10, 0, 0), sample(20, 0, 0.8)])

      expect(dabs.length).toBeGreaterThan(0)
      for (const dab of dabs) expect(dab.radius).toBeCloseTo(20 * 0.8)
    })

    it('does not open a stroke at full radius when the opening sample reports 0 pressure', () => {
      const sampler = createBrushSampler({ radius: 20, opacity: 1 })
      const [dab] = sampler.begin(sample(0, 0, 0))

      expect(dab.radius).toBe(0)
    })

    it("carries the first segment's width up from the opening rather than starting at full", () => {
      const sampler = createBrushSampler({ radius: 20, opacity: 1 })
      sampler.begin(sample(0, 0, 0))
      const dabs = sampler.push([sample(40, 0, 0.8)])

      expect(dabs.length).toBeGreaterThan(1)
      expect(dabs[0].radius).toBeLessThan(20 * 0.8)
      for (let i = 1; i < dabs.length; i++) {
        expect(dabs[i].radius).toBeGreaterThanOrEqual(dabs[i - 1].radius)
      }
      expect(dabs[dabs.length - 1].radius).toBeGreaterThan(dabs[0].radius)
    })

    it('takes the last valid pressure for a release reporting 0, not 0 itself', () => {
      const sampler = createBrushSampler({ radius: 20, opacity: 1 })
      sampler.begin(sample(0, 0, 0.6))
      sampler.push([sample(50, 0, 0.6)])
      const dabs = sampler.end(sample(60, 0, 0))

      expect(dabs.length).toBeGreaterThan(0)
      for (const dab of dabs) expect(dab.radius).toBeCloseTo(20 * 0.6)
    })

    it("keeps consecutive spacing tracking each dab's own size along a rising-then-falling pressure slope", () => {
      const shape = { radius: 40, opacity: 1 }
      const points = Array.from({ length: 200 }, (_, i) => {
        const t = i / 199
        const pressure = t < 0.5 ? 0.1 + t * 1.8 : 0.1 + (1 - t) * 1.8
        return sample(i * 2, 0, Math.min(1, pressure))
      })

      const sampler = createBrushSampler(shape)
      const dabs = [...sampler.begin(sample(0, 0, 0.1)), ...sampler.push(points)]

      // The spacing a dab leaves behind it is recomputed from its own size, so
      // the gap that follows it is bounded by that dab's radius, not the one
      // ahead of it.
      for (let i = 1; i < dabs.length; i++) {
        const gap = dist(dabs[i - 1], dabs[i])
        const spacing = Math.max(1, dabs[i - 1].radius * 2 * DEFAULT_BRUSH_SPACING_RATIO)
        expect(gap).toBeLessThanOrEqual(spacing + 1e-9)
      }
    })
  })

  describe('the stabilizer', () => {
    it('leaves the path untouched at zero strength, matching the unstabilized sampler exactly', () => {
      const raw = createBrushSampler({ radius: 12, opacity: 1 })
      raw.begin(sample(0, 0))
      const rawDabs = raw.push([sample(5, 3), sample(9, -2), sample(20, 10)])

      const offExplicit = createBrushSampler({ radius: 12, opacity: 1 }, DEFAULT_BRUSH_SPACING_RATIO, 0)
      offExplicit.begin(sample(0, 0))
      const offDabs = offExplicit.push([sample(5, 3), sample(9, -2), sample(20, 10)])

      expect(offDabs).toEqual(rawDabs)
    })

    it('moves the path away from the unfiltered one once switched on', () => {
      const points = [sample(50, 0), sample(50, 50), sample(0, 50)]
      const raw = createBrushSampler({ radius: 12, opacity: 1 })
      raw.begin(sample(0, 0))
      const rawDabs = raw.push(points)

      const stabilized = createBrushSampler({ radius: 12, opacity: 1 }, DEFAULT_BRUSH_SPACING_RATIO, 0.7)
      stabilized.begin(sample(0, 0))
      const stabilizedDabs = stabilized.push(points)

      expect(stabilizedDabs).not.toEqual(rawDabs)
    })

    it('is deterministic: the same calls against the same samples produce the same dabs every time', () => {
      const points = [sample(8, 4), sample(19, -3), sample(31, 12), sample(40, 9)]
      const run = (): Dab[] => {
        const sampler = createBrushSampler({ radius: 15, opacity: 1 }, DEFAULT_BRUSH_SPACING_RATIO, 0.6)
        return [...sampler.begin(sample(0, 0)), ...sampler.push(points)]
      }

      expect(run()).toEqual(run())
    })

    it('does not care where a fixed run of samples is split into pushes, once it is switched on', () => {
      // The same points as ticket 04's grouping invariant, not the split's own
      // interpolated ones: this is a regrouping of one fixed sequence, and a
      // causal filter consuming it in the same order must not care where the
      // batch boundaries fell.
      const points = [sample(10, 0), sample(10, 10), sample(25, 10), sample(25, -5), sample(40, -5)]
      const shape = { radius: 12, opacity: 1 }
      const strength = 0.65

      const runWith = (splits: BrushSample[][]): Dab[] => {
        const sampler = createBrushSampler(shape, DEFAULT_BRUSH_SPACING_RATIO, strength)
        const dabs = [...sampler.begin(sample(0, 0))]
        for (const batch of splits) dabs.push(...sampler.push(batch))
        return dabs
      }

      const whole = runWith([points])
      const perSample = runWith(points.map((p) => [p]))
      const uneven = runWith([points.slice(0, 2), points.slice(2, 3), points.slice(3)])

      expect(perSample).toEqual(whole)
      expect(uneven).toEqual(whole)
    })

    it('keeps the pointer no further behind than the lag it settles into, however long the stroke runs', () => {
      const sampler = createBrushSampler({ radius: 2, opacity: 1 }, DEFAULT_BRUSH_SPACING_RATIO, 0.8)
      let lastDab: Dab = sampler.begin(sample(0, 0))[0]
      let x = 0
      const step = 10

      function advanceBy(n: number): number {
        for (let i = 0; i < n; i++) {
          x += step
          const dabs = sampler.push([sample(x, 0)])
          if (dabs.length > 0) lastDab = dabs[dabs.length - 1]
        }
        return x - lastDab.x
      }

      const earlyLag = advanceBy(50)
      const laterLag = advanceBy(500)

      // Bounded, not diverging: a longer straight run settles at the same
      // trailing distance rather than falling further and further behind.
      expect(Math.abs(laterLag - earlyLag)).toBeLessThan(2)
    })

    it('never changes a dab already handed back, however far the stroke continues afterwards', () => {
      const sampler = createBrushSampler({ radius: 10, opacity: 1 }, DEFAULT_BRUSH_SPACING_RATIO, 0.7)
      sampler.begin(sample(0, 0))
      const early = sampler.push([sample(30, 0)])
      const snapshot = early.map((d) => ({ ...d }))

      sampler.push([sample(80, 40)])
      sampler.end(sample(200, -30))

      expect(early).toEqual(snapshot)
    })

    it('catches the tail up to the release position rather than leaving a stretch unwalked', () => {
      const shape = { radius: 10, opacity: 1 }
      const sampler = createBrushSampler(shape, DEFAULT_BRUSH_SPACING_RATIO, 0.85)
      sampler.begin(sample(0, 0))
      sampler.push(Array.from({ length: 30 }, (_, i) => sample((i + 1) * 5, 0)))

      const spacing = shape.radius * 2 * DEFAULT_BRUSH_SPACING_RATIO
      const dabs = sampler.end(sample(400, 0))

      expect(dabs.length).toBeGreaterThan(0)
      expect(400 - dabs[dabs.length - 1].x).toBeLessThanOrEqual(spacing + 1e-9)
    })
  })
})
