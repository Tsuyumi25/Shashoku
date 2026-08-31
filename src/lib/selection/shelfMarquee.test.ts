import { describe, expect, it } from 'vitest'
import {
  bandBoundary,
  clampToTerritory,
  clientToContent,
  edgeDistance,
  edgeDistanceFactor,
  edgeTimeFactor,
  resolveFrame,
  scrollEdgeFor,
  scrollZoneDepth,
  territoryAt,
  touchedKeys,
  type CardBox,
} from '@/lib/selection/shelfMarquee'

describe('clientToContent', () => {
  it('reads the same pointer position further down the content once scrolled', () => {
    const frame = { left: 10, top: 20, scrollLeft: 0, scrollTop: 100 }
    expect(clientToContent(50, 60, frame)).toEqual({ x: 40, y: 140 })

    const scrolled = { ...frame, scrollTop: 140 }
    expect(clientToContent(50, 60, scrolled)).toEqual({ x: 40, y: 180 })
  })

  it('folds in horizontal scroll the same way', () => {
    const frame = { left: 0, top: 0, scrollLeft: 30, scrollTop: 0 }
    expect(clientToContent(5, 5, frame)).toEqual({ x: 35, y: 5 })
  })
})

describe('bandBoundary and territoryAt', () => {
  it('sits at the midpoint of the gap between the two bands', () => {
    const boundary = bandBoundary(200, 220)
    expect(boundary).toBe(210)
    expect(territoryAt(209, boundary)).toBe('project')
    expect(territoryAt(210, boundary)).toBe('file')
  })

  it('gives the whole scroller to the file band when there is no project band', () => {
    const boundary = bandBoundary(null, 40)
    expect(territoryAt(-1000, boundary)).toBe('file')
  })

  it('gives the whole scroller to the project band when there is no file band', () => {
    const boundary = bandBoundary(300, null)
    expect(territoryAt(100_000, boundary)).toBe('project')
  })
})

describe('clampToTerritory', () => {
  const boundary = 200

  it('cuts a project-territory rect flat at the boundary rather than crossing it', () => {
    const dragged = clampToTerritory({ x: 0, y: 100, w: 50, h: 150 }, 'project', boundary)
    expect(dragged).toEqual({ x: 0, y: 100, w: 50, h: 100 })
  })

  it('cuts a file-territory rect flat at the boundary from the other side', () => {
    const dragged = clampToTerritory({ x: 0, y: 150, w: 50, h: 100 }, 'file', boundary)
    expect(dragged).toEqual({ x: 0, y: 200, w: 50, h: 50 })
  })

  it('leaves a rect already inside its own territory untouched', () => {
    const inside = { x: 0, y: 0, w: 50, h: 50 }
    expect(clampToTerritory(inside, 'project', boundary)).toEqual(inside)
  })
})

describe('touchedKeys', () => {
  const cards: CardBox[] = [
    { key: 'a', box: { x: 0, y: 0, w: 40, h: 40 } },
    { key: 'b', box: { x: 100, y: 0, w: 40, h: 40 } },
  ]

  it('catches a card the marquee only grazes at its edge', () => {
    expect(touchedKeys(cards, { x: 30, y: 10, w: 10, h: 10 })).toEqual(['a'])
  })

  it('misses a card the marquee never reaches', () => {
    expect(touchedKeys(cards, { x: 0, y: 0, w: 40, h: 40 })).toEqual(['a'])
  })
})

describe('resolveFrame', () => {
  it('replaces with just this frame\'s hits when not additive', () => {
    expect(resolveFrame(['a', 'b'], ['c'], false)).toEqual(['c'])
  })

  it('unions with the snapshot rather than toggling a card already in it', () => {
    // Ctrl held over a card that was already selected before the drag began
    // must leave it selected, not flip it off.
    expect(resolveFrame(['a'], ['a'], true)).toEqual(['a'])
  })

  it('adds a newly touched card to the snapshot', () => {
    expect(resolveFrame(['a'], ['b'], true).sort()).toEqual(['a', 'b'])
  })

  it('lands a card selected exactly once after passing over it, off, and over again', () => {
    // Three independent frames, each recomputed from the same fixed
    // snapshot rather than from the frame before it.
    const base = ['x']
    const over = resolveFrame(base, ['a'], false)
    const off = resolveFrame(base, [], false)
    const overAgain = resolveFrame(base, ['a'], false)
    expect(over).toEqual(['a'])
    expect(off).toEqual([])
    expect(overAgain).toEqual(['a'])
    expect(overAgain.filter((key) => key === 'a')).toHaveLength(1)
  })
})

describe('edge auto-scroll math', () => {
  it('sizes the test zone from the visible height, clamped to 64–120px', () => {
    expect(scrollZoneDepth(200)).toBe(64)
    expect(scrollZoneDepth(320)).toBe(80)
    expect(scrollZoneDepth(1000)).toBe(120)
  })

  it('caps the distance factor at half the zone depth rather than only at the edge', () => {
    const zone = 120
    expect(edgeDistanceFactor(120, zone)).toBe(0)
    expect(edgeDistanceFactor(60, zone)).toBe(1)
    expect(edgeDistanceFactor(90, zone)).toBeCloseTo(0.5)
    expect(edgeDistanceFactor(0, zone)).toBe(1)
  })

  it('holds the time factor at zero through the initial delay, then ramps linearly', () => {
    expect(edgeTimeFactor(50)).toBe(0)
    expect(edgeTimeFactor(100)).toBe(0)
    expect(edgeTimeFactor(250)).toBeCloseTo(0.5)
    expect(edgeTimeFactor(400)).toBe(1)
    expect(edgeTimeFactor(999)).toBe(1)
  })

  it('scrolls only once the clamped box is pressed against the visible edge', () => {
    // A band taller than the viewport: the box reaches the visible bottom.
    expect(scrollEdgeFor({ x: 0, y: 0, w: 10, h: 500 }, 0, 400)).toBe('down')
    // A band that fits inside the viewport: the box never gets that far,
    // even though the raw pointer might be past it.
    expect(scrollEdgeFor({ x: 0, y: 50, w: 10, h: 200 }, 0, 400)).toBe(null)
    expect(scrollEdgeFor({ x: 0, y: -50, w: 10, h: 50 }, 0, 400)).toBe('up')
  })

  it('measures distance to whichever edge is in play', () => {
    expect(edgeDistance('down', 380, 0, 400)).toBe(20)
    expect(edgeDistance('up', 20, 0, 400)).toBe(20)
    expect(edgeDistance(null, 20, 0, 400)).toBe(Infinity)
  })
})
