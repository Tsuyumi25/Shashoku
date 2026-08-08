import { describe, expect, it } from 'vitest'
import { obbHoldsPoint, obbIntersectsRect } from './obb'

const upright = { center: { x: 100, y: 100 }, w: 40, h: 20, rotation: 0 }

describe('obbIntersectsRect', () => {
  it('catches a box the rectangle contains', () => {
    expect(obbIntersectsRect(upright, { x: 50, y: 50, w: 100, h: 100 })).toBe(true)
  })

  it('catches a box that only overlaps the rectangle', () => {
    expect(obbIntersectsRect(upright, { x: 115, y: 95, w: 100, h: 10 })).toBe(true)
  })

  it('misses a box the rectangle does not reach', () => {
    expect(obbIntersectsRect(upright, { x: 0, y: 0, w: 10, h: 10 })).toBe(false)
  })

  it('catches a box that swallows the rectangle', () => {
    const big = { center: { x: 100, y: 100 }, w: 400, h: 400, rotation: 0 }
    expect(obbIntersectsRect(big, { x: 95, y: 95, w: 4, h: 4 })).toBe(true)
  })

  it('touching along an edge counts as touching', () => {
    expect(obbIntersectsRect(upright, { x: 120, y: 95, w: 10, h: 10 })).toBe(true)
  })

  /**
   * The reason this is not an axis-aligned approximation. A long label turned
   * 45° has an upright bounding box far larger than the label, and the corners
   * of that box are exactly where a marquee gets it wrong — a drag near one
   * would sweep in an object whose ink it never touched.
   */
  it('misses the corner of a turned box that its upright bounds would catch', () => {
    const turned = { center: { x: 100, y: 100 }, w: 100, h: 10, rotation: Math.PI / 4 }
    // Inside the upright bounds (about x,y ∈ [61,139]) but well clear of the
    // band the object actually occupies, which runs top-left to bottom-right.
    expect(obbIntersectsRect(turned, { x: 64, y: 128, w: 8, h: 8 })).toBe(false)
    // The same small square moved onto the diagonal the object runs along.
    expect(obbIntersectsRect(turned, { x: 64, y: 64, w: 8, h: 8 })).toBe(true)
  })

  it('catches a turned box through its long side', () => {
    const turned = { center: { x: 100, y: 100 }, w: 100, h: 10, rotation: Math.PI / 2 }
    expect(obbIntersectsRect(turned, { x: 95, y: 140, w: 10, h: 10 })).toBe(true)
    expect(obbIntersectsRect(turned, { x: 130, y: 95, w: 10, h: 10 })).toBe(false)
  })

  /** A marquee that never moved is a click, and a click selects what it is on. */
  it('treats an empty rectangle as the point it sits at', () => {
    expect(obbIntersectsRect(upright, { x: 100, y: 100, w: 0, h: 0 })).toBe(true)
    expect(obbIntersectsRect(upright, { x: 300, y: 300, w: 0, h: 0 })).toBe(false)
  })
})

describe('obbHoldsPoint', () => {
  const box = { center: { x: 100, y: 100 }, w: 100, h: 40, rotation: 0 }

  it('holds a point inside it and lets go of one outside', () => {
    expect(obbHoldsPoint(box, { x: 100, y: 100 })).toBe(true)
    expect(obbHoldsPoint(box, { x: 160, y: 100 })).toBe(false)
  })

  // The edge counts: a click on the outline is a click on the object, and
  // refusing it would make the boundary a place nothing can be picked.
  it('holds a point on its edge', () => {
    expect(obbHoldsPoint(box, { x: 150, y: 100 })).toBe(true)
  })

  it('turns with the object rather than testing its upright bounds', () => {
    const turned = { center: { x: 100, y: 100 }, w: 100, h: 10, rotation: Math.PI / 2 }
    expect(obbHoldsPoint(turned, { x: 100, y: 140 })).toBe(true)
    expect(obbHoldsPoint(turned, { x: 140, y: 100 })).toBe(false)
  })
})
