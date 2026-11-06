import { describe, expect, it } from 'vitest'
import {
  chainsOf,
  distanceToRoute,
  distanceToSegment,
  edgeAnchors,
  nearestAnchor,
  routeBetween,
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

describe('a line between frames that overlap', () => {
  it('is still drawn, for frames overlapping or standing in the same place', () => {
    for (const [from, to] of [[box(0, 0), box(20, 0)], [box(7, 9), box(7, 9)]] as const) {
      const route = routeBetween(from, to, 10)
      expect([route.a.x, route.a.y, route.b.x, route.b.y].every(Number.isFinite)).toBe(true)
    }
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

describe('routing a line', () => {
  const heading = (from: { x: number; y: number }, to: { x: number; y: number }) =>
    Math.atan2(to.y - from.y, to.x - from.x)
  const outward = (frame: FrameBox, at: { x: number; y: number }) => heading(frame.center, at)

  /** It leaves straight out of its edge and arrives straight into the other's. */
  it('launches out of one edge and into the other', () => {
    const from = box(0, 0)
    const to = box(600, 600)
    const route = routeBetween(from, to, 10)
    expect(heading(route.points[0]!, route.points[1]!)).toBeCloseTo(outward(from, route.a), 6)
    expect(Math.atan2(-route.arrive.y, -route.arrive.x)).toBeCloseTo(outward(to, route.b), 6)
  })

  /** No corner anywhere: consecutive steps along the path never turn by more than a sampling step. */
  it('turns smoothly all the way', () => {
    const route = routeBetween(box(0, 0), box(600, 600), 10)
    const p = route.points
    for (let at = 2; at < p.length; at++) {
      const turn = heading(p[at - 1]!, p[at]!) - heading(p[at - 2]!, p[at - 1]!)
      expect(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))).toBeLessThan(0.1)
    }
  })

  it('joins the facing edges of a pair that is far enough apart', () => {
    const route = routeBetween(box(0, 0), box(600, 0), 10)
    expect(route.a).toEqual({ x: 50, y: 0 })
    expect(route.b).toEqual({ x: 550, y: 0 })
  })

  /** Side by side and close, the facing edges would launch into each other, so it goes round the outside. */
  it('lands a close pair on an outer edge rather than the facing one', () => {
    const route = routeBetween(box(0, 0), box(130, 0), 10)
    expect(route.a.x).toBeCloseTo(0, 6)
    expect(route.b.x).toBeCloseTo(130, 6)
    expect(Math.abs(route.b.y)).toBeCloseTo(20, 6)
  })

  /** A click on the path as drawn lands on it; one on the straight chord beneath does not. */
  it('is hit along the path rather than along its chord', () => {
    const route = routeBetween(box(0, 0), box(130, 0), 10)
    const apex = route.points.reduce((top, p) => (p.y < top.y ? p : top))
    expect(distanceToRoute(apex, route.points)).toBeLessThan(1)
    expect(distanceToRoute({ x: (route.a.x + route.b.x) / 2, y: (route.a.y + route.b.y) / 2 }, route.points)).toBeGreaterThan(20)
  })
})

describe('where a line sets out', () => {
  it('leaves from another edge than the one a line arrives at', () => {
    const second = box(600, 0)
    const third = box(300, 300)
    const unhindered = routeBetween(second, third, 10).a
    expect(routeBetween(second, third, 10, [unhindered]).a).not.toEqual(unhindered)
  })

  /** Its arrival settled, only the start moves. */
  it('keeps an arrival it was handed', () => {
    const arrival = { x: 300, y: 280 }
    expect(routeBetween(box(600, 0), box(300, 300), 10, [], arrival).b).toEqual(arrival)
  })
})

describe('chainsOf', () => {
  const at = (chains: Map<string, number>, from: string, to: string) => chains.get(JSON.stringify([from, to]))

  it('keeps a straight run in one chain and gives each branch of a fork its own', () => {
    const chains = chainsOf(
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
        { from: 'c', to: 'e' },
      ],
      ['a', 'b', 'c', 'd', 'e'],
    )
    expect(at(chains, 'a', 'b')).toBe(at(chains, 'b', 'c'))
    expect(new Set([at(chains, 'a', 'b'), at(chains, 'c', 'd'), at(chains, 'c', 'e')]).size).toBe(3)
  })

  it('starts a new chain after a merge', () => {
    const chains = chainsOf(
      [
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
      ],
      ['a', 'b', 'c', 'd'],
    )
    expect(new Set([at(chains, 'a', 'c'), at(chains, 'b', 'c'), at(chains, 'c', 'd')]).size).toBe(3)
  })
})
