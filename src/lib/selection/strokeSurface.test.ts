import { describe, expect, it } from 'vitest'
import {
  coverageWithin,
  cutToMask,
  EMPTY_SURFACE,
  raiseInto,
  surfaceHolding,
  type StrokeSurface,
} from '@/lib/selection/strokeSurface'

const PAGE_W = 400
const PAGE_H = 300

const grow = (surface: StrokeSurface, need: { x: number; y: number; w: number; h: number }) =>
  surfaceHolding(surface, need, PAGE_W, PAGE_H)

const holds = (
  outer: { x: number; y: number; w: number; h: number },
  inner: { x: number; y: number; w: number; h: number },
): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h

describe('surfaceHolding', () => {
  it('opens a region around the first thing asked of it', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })

    expect(holds(surface.region, { x: 100, y: 100, w: 20, h: 20 })).toBe(true)
    expect(surface.coverage.length).toBe(surface.region.w * surface.region.h)
  })

  it('hands back the very same surface when it already covers the ask', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })

    expect(grow(surface, { x: 105, y: 105, w: 4, h: 4 })).toBe(surface)
  })

  it('carries what was drawn into the larger region, at the same page pixels', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })
    const at = (s: StrokeSurface, x: number, y: number) =>
      s.coverage[(y - s.region.y) * s.region.w + (x - s.region.x)]
    surface.coverage[(110 - surface.region.y) * surface.region.w + (110 - surface.region.x)] = 200

    const grown = grow(surface, { x: 380, y: 280, w: 10, h: 10 })

    expect(grown).not.toBe(surface)
    expect(at(grown, 110, 110)).toBe(200)
    expect(at(grown, 111, 110)).toBe(0)
  })

  it('never reaches outside the page', () => {
    const surface = grow(EMPTY_SURFACE, { x: -50, y: -50, w: 60, h: 60 })

    expect(surface.region.x).toBe(0)
    expect(surface.region.y).toBe(0)
    expect(surface.region.w).toBeLessThanOrEqual(PAGE_W)
    expect(surface.region.h).toBeLessThanOrEqual(PAGE_H)
  })

  /**
   * The reason growth is proportional: a stroke that walks across a page would
   * otherwise copy everything it had drawn at every step, which is quadratic in
   * its own length.
   */
  it('grows by more than it was asked for, so a walk does not reallocate per step', () => {
    let surface = grow(EMPTY_SURFACE, { x: 0, y: 0, w: 4, h: 4 })
    let allocations = 0
    for (let x = 0; x < 200; x += 4) {
      const next = grow(surface, { x, y: 0, w: 4, h: 4 })
      if (next !== surface) allocations++
      surface = next
    }

    expect(allocations).toBeLessThan(5)
  })

  it('ignores an ask that lies entirely off the page', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })

    expect(grow(surface, { x: 900, y: 900, w: 10, h: 10 })).toBe(surface)
  })
})

describe('coverageWithin', () => {
  it('lifts a box out row by row', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })
    const put = (x: number, y: number, v: number) => {
      surface.coverage[(y - surface.region.y) * surface.region.w + (x - surface.region.x)] = v
    }
    put(100, 100, 10)
    put(101, 100, 20)
    put(100, 101, 30)

    const out = coverageWithin(surface, { x: 100, y: 100, w: 2, h: 2 })

    expect([...out]).toEqual([10, 20, 30, 0])
  })
})

describe('cutToMask', () => {
  const row = { x: 0, y: 0, w: 4, h: 1 }

  it('scales coverage by the selection rather than thresholding it', () => {
    const coverage = new Uint8Array([255, 255, 128, 60])
    cutToMask(coverage, row, new Uint8ClampedArray([255, 0, 255, 128]), row)

    expect([...coverage]).toEqual([255, 0, 128, 30])
  })

  /**
   * A selection stops at the page while the region handed to the engine can
   * reach past it, on a layer larger than the page. Out there the stroke has
   * laid nothing down, so leaving it alone and cutting it come to the same
   * thing — and only one of them can be indexed.
   */
  it('leaves the part the selection does not reach where it is', () => {
    const coverage = new Uint8Array([9, 255, 255, 9])
    cutToMask(coverage, row, new Uint8ClampedArray([0, 255]), { x: 1, y: 0, w: 2, h: 1 })

    expect([...coverage]).toEqual([9, 0, 255, 9])
  })
})

describe('raiseInto', () => {
  const at = (s: StrokeSurface, x: number, y: number) =>
    s.coverage[(y - s.region.y) * s.region.w + (x - s.region.x)]
  const put = (s: StrokeSurface, x: number, y: number, v: number) => {
    s.coverage[(y - s.region.y) * s.region.w + (x - s.region.x)] = v
  }

  /**
   * The ceiling a stroke crossing itself needs. It is taken here rather than by
   * the stamp because what arrives has already been cut to the selection, and a
   * stamp reaching straight into the surface would put back what the cut took.
   */
  it('takes the stronger of the two and never lowers what is there', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })
    put(surface, 100, 100, 200)
    put(surface, 101, 100, 50)

    raiseInto(surface, new Uint8ClampedArray([120, 180]), { x: 100, y: 100, w: 2, h: 1 })

    expect(at(surface, 100, 100)).toBe(200)
    expect(at(surface, 101, 100)).toBe(180)
  })

  /** Coverage a stamp did not reach is zero, and the ceiling passes over it. */
  it('leaves alone what the values did not reach', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })
    put(surface, 100, 100, 77)

    raiseInto(surface, new Uint8ClampedArray([0, 0]), { x: 100, y: 100, w: 2, h: 1 })

    expect(at(surface, 100, 100)).toBe(77)
  })

  it('lands on the page pixels the window names, wherever the surface starts', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })

    raiseInto(surface, new Uint8ClampedArray([9, 8, 7, 6]), { x: 110, y: 105, w: 2, h: 2 })

    expect(at(surface, 110, 105)).toBe(9)
    expect(at(surface, 111, 105)).toBe(8)
    expect(at(surface, 110, 106)).toBe(7)
    expect(at(surface, 111, 106)).toBe(6)
  })

  /**
   * A segment's window is clamped to the page and the surface is grown to hold
   * it before this runs, so a stroke never asks for this. A merge that ran off
   * the end would write into a neighbouring row rather than throw.
   */
  it('keeps to the part the surface actually covers', () => {
    const surface = grow(EMPTY_SURFACE, { x: 0, y: 0, w: 4, h: 4 })
    const before = [...surface.coverage]

    raiseInto(surface, new Uint8ClampedArray(4), { x: 900, y: 900, w: 2, h: 2 })

    expect([...surface.coverage]).toEqual(before)
  })
})

describe('coverageWithin, answered in a buffer', () => {
  it('uses the buffer it was handed, as a view of exactly the box', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })
    const scratch = new Uint8Array(64)

    const out = coverageWithin(surface, { x: 100, y: 100, w: 2, h: 2 }, scratch)

    expect(out.length).toBe(4)
    expect(out.buffer).toBe(scratch.buffer)
  })

  /**
   * The whole hazard of keeping one between segments: a wide segment fills more
   * of it than a narrow one, and what the wide one left is not coverage.
   */
  it('clears what the buffer was holding from the segment before', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })
    const edge = surface.region.x + surface.region.w
    const scratch = new Uint8Array(64).fill(255)

    // Straddling the edge on purpose. The half inside is copied over either
    // way; the half the surface never reached is uncovered only because the
    // buffer was cleared, which is the whole of what a fresh one used to give.
    const out = coverageWithin(surface, { x: edge - 1, y: 100, w: 2, h: 1 }, scratch)

    expect([...out]).toEqual([0, 0])
  })

  it('allocates rather than overrun a buffer too small for the box', () => {
    const surface = grow(EMPTY_SURFACE, { x: 100, y: 100, w: 20, h: 20 })
    const scratch = new Uint8Array(2)

    const out = coverageWithin(surface, { x: 100, y: 100, w: 2, h: 2 }, scratch)

    expect(out.length).toBe(4)
    expect(out.buffer).not.toBe(scratch.buffer)
  })
})
