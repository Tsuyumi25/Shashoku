import { describe, expect, it } from 'vitest'
import {
  distanceToSegment,
  edgeAnchors,
  nearestAnchor,
  readingLineBetween,
  type FrameBox,
} from './readingLine'

function box(x: number, y: number, w = 100, h = 40, rotation = 0): FrameBox {
  return { center: { x, y }, w, h, rotation }
}

const near = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6)
  expect(p.y).toBeCloseTo(y, 6)
}

describe('edgeAnchors', () => {
  it('offers the four edge midpoints and nothing between them', () => {
    const anchors = edgeAnchors(box(0, 0, 100, 40))
    expect(anchors).toHaveLength(4)
    near(anchors[0], 0, -20)
    near(anchors[1], 50, 0)
    near(anchors[2], 0, 20)
    near(anchors[3], -50, 0)
  })

  // They ride with the object, so a frame set on a slant is met at its own edge
  // rather than somewhere across it.
  it('turns them with the object', () => {
    const anchors = edgeAnchors(box(0, 0, 100, 40, Math.PI / 2))
    near(anchors[0], 20, 0)
    near(anchors[1], 0, 50)
  })
})

describe('nearestAnchor', () => {
  it('takes the edge facing whatever is being reached for', () => {
    near(nearestAnchor(box(0, 0, 100, 40), { x: 500, y: 0 }), 50, 0)
    near(nearestAnchor(box(0, 0, 100, 40), { x: 0, y: -500 }), 0, -20)
  })

  /**
   * Four places and no fifth. A point on the diagonal lands on whichever of the
   * four is nearest rather than somewhere along the edge — the same four every
   * time is what makes a line's ends predictable instead of sliding as objects
   * are nudged.
   */
  it('lands on one of the four rather than sliding along an edge', () => {
    const at = nearestAnchor(box(0, 0, 100, 40), { x: 300, y: 300 })
    expect(edgeAnchors(box(0, 0, 100, 40))).toContainEqual(at)
  })
})

describe('readingLineBetween', () => {
  it('runs edge to edge rather than centre to centre', () => {
    const line = readingLineBetween(box(0, 0, 100, 40), box(400, 0, 100, 40))
    near(line.a, 50, 0)
    near(line.b, 350, 0)
  })

  it('leaves from the bottom and arrives at the top for an object below', () => {
    const line = readingLineBetween(box(0, 0, 100, 40), box(0, 300, 100, 40))
    near(line.a, 0, 20)
    near(line.b, 0, 280)
  })

  /**
   * ⚠️ Two frames that overlap still get a line. It reads oddly — the ends are
   * on the inward-facing edges, so it runs against the way the objects lie —
   * but a line the file holds and the canvas declines to draw is worse than one
   * that looks wrong: the first cannot be found, and the second says out loud
   * that two objects are sitting on top of each other.
   */
  it('still draws between two frames that overlap', () => {
    const line = readingLineBetween(box(0, 0, 100, 40), box(20, 0, 100, 40))
    expect(line).not.toBeNull()
    expect(Number.isFinite(line.a.x)).toBe(true)
    expect(Number.isFinite(line.b.x)).toBe(true)
  })

  it('still answers for two objects standing in the same place', () => {
    const line = readingLineBetween(box(7, 9), box(7, 9))
    expect(Number.isFinite(line.a.x)).toBe(true)
    expect(Number.isFinite(line.b.y)).toBe(true)
  })
})

describe('distanceToSegment', () => {
  it('measures straight across to the line', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3, 6)
  })

  it('measures to the nearer end once past it, not to the line it lies on', () => {
    expect(distanceToSegment({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(10, 6)
  })

  it('measures to the point itself when the two ends are one', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeCloseTo(5, 6)
  })
})
