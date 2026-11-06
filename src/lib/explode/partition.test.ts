import { describe, expect, it } from 'vitest'
import {
  landingAt,
  partitionPage,
  regionAt,
  regionsTouching,
  stepFor,
  type Partition,
  type Rect,
} from './partition'

const PAGE = { w: 1200, h: 1731 }

/** A page of balloons: a few clusters, a pair set close enough to share a seed. */
const BOXES: Rect[] = [
  { x: 95, y: 120, w: 150, h: 220 },
  { x: 250, y: 140, w: 90, h: 180 },
  { x: 820, y: 90, w: 180, h: 260 },
  { x: 140, y: 700, w: 220, h: 160 },
  { x: 640, y: 620, w: 120, h: 300 },
  { x: 900, y: 780, w: 160, h: 140 },
  { x: 180, y: 1180, w: 200, h: 180 },
  { x: 700, y: 1250, w: 140, h: 240 },
  { x: 980, y: 1420, w: 150, h: 160 },
  { x: 420, y: 1520, w: 180, h: 120 },
]

/** Every cell the box covers, which is what a region boundary must not divide. */
function regionsUnder(partition: Partition, box: Rect): Set<number> {
  const out = new Set<number>()
  for (let gy = Math.floor(box.y / partition.step); gy < Math.ceil((box.y + box.h) / partition.step); gy++)
    for (let gx = Math.floor(box.x / partition.step); gx < Math.ceil((box.x + box.w) / partition.step); gx++)
      if (gx >= 0 && gy >= 0 && gx < partition.gw && gy < partition.gh)
        out.add(partition.cells[gy * partition.gw + gx])
  return out
}

describe('partitionPage', () => {
  it('cuts no OCR box in two, at every merge threshold', () => {
    for (const cap of [0.05, 0.1, 0.2, 0.35, 0.5]) {
      const partition = partitionPage(PAGE, BOXES, cap)
      const cut = BOXES.filter((box) => regionsUnder(partition, box).size > 1)
      expect(cut, `cap ${cap}`).toEqual([])
    }
  })

  it('is one region at the whole-page threshold, which is the canvas as it was', () => {
    const partition = partitionPage(PAGE, BOXES, 1)
    expect(partition.regions).toHaveLength(1)
    expect(regionAt(partition, 5, 5)).toBe(0)
    expect(regionAt(partition, PAGE.w - 5, PAGE.h - 5)).toBe(0)
  })

  it('gives a page nothing was read on one region over the whole of it', () => {
    const partition = partitionPage(PAGE, [], 0.2)
    expect(partition.regions).toHaveLength(1)
    expect(partition.regions[0].anchor).toEqual({ x: PAGE.w / 2, y: PAGE.h / 2 })
    expect(regionAt(partition, 600, 900)).toBe(0)
  })

  it('reads a point off the page as no region at all', () => {
    const partition = partitionPage(PAGE, BOXES, 0.2)
    expect(regionAt(partition, -1, 100)).toBe(-1)
    expect(regionAt(partition, 100, -1)).toBe(-1)
    expect(regionAt(partition, PAGE.w + 1, 100)).toBe(-1)
    expect(regionAt(partition, 100, PAGE.h + 1)).toBe(-1)
  })

  it('draws each region over exactly the cells it owns', () => {
    const partition = partitionPage(PAGE, BOXES, 0.15)
    const owned = new Int16Array(partition.gw * partition.gh).fill(-1)
    partition.regions.forEach((region, r) => {
      expect(region.runs.length).toBeGreaterThan(0)
      for (const run of region.runs) {
        const gy = Math.floor((run.y + run.h / 2) / partition.step)
        const from = Math.round(run.x / partition.step)
        const to = Math.round((run.x + run.w - 0.25) / partition.step)
        for (let gx = from; gx < to; gx++) owned[gy * partition.gw + gx] = r
      }
    })
    expect([...owned]).toEqual([...partition.cells])
  })

  it('shares the whole page out between the regions and nothing beyond it', () => {
    const partition = partitionPage(PAGE, BOXES, 0.15)
    expect(partition.regions.length).toBeGreaterThan(1)
    const total = partition.regions.reduce((sum, r) => sum + r.area, 0)
    expect(total).toBeCloseTo(1, 6)
  })

  it('splits the page further as the threshold comes down', () => {
    const counts = [0.05, 0.1, 0.2, 0.5, 1].map((cap) => partitionPage(PAGE, BOXES, cap).regions.length)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(counts.at(-1)).toBe(1)
  })

  it('scales the grid with the page rather than holding a pixel size', () => {
    expect(stepFor({ w: 1200, h: 800 })).toBe(3)
    expect(stepFor({ w: 60, h: 40 })).toBe(2)
    expect(stepFor({ w: 4000, h: 3000 })).toBe(10)
  })
})

/** The travel each region is given, as the store gives it: out from the page's middle. */
function offsetsOf(partition: Partition, factor: number) {
  const offsets = partition.regions.map((region) => ({
    x: (region.anchor.x - PAGE.w / 2) * factor,
    y: (region.anchor.y - PAGE.h / 2) * factor,
  }))
  return (region: number) => offsets[region]
}

/** A cell the given region owns outright, in page pixels. */
function pointIn(partition: Partition, region: number): { x: number; y: number } {
  for (const run of partition.regions[region].runs) {
    const p = { x: run.x + run.w / 2, y: run.y + run.h / 2 }
    if (regionAt(partition, p.x, p.y) === region) return p
  }
  throw new Error(`region ${region} owns no cell`)
}

describe('regionsTouching', () => {
  const partition = partitionPage(PAGE, BOXES, 0.15)

  it('names one region for a frame that stands inside one', () => {
    const p = pointIn(partition, 0)
    expect(regionsTouching(partition, { x: p.x - 1, y: p.y - 1, w: 2, h: 2 })).toEqual([0])
  })

  it('names every region a frame reaches into, the one holding its middle first', () => {
    const whole = regionsTouching(partition, { x: 0, y: 0, w: PAGE.w, h: PAGE.h })
    expect(whole).toHaveLength(partition.regions.length)
    expect(whole[0]).toBe(regionAt(partition, PAGE.w / 2, PAGE.h / 2))
    expect([...whole].sort((a, b) => a - b)).toEqual(partition.regions.map((_, r) => r))
  })

  it('names none for a frame that is off the page altogether', () => {
    expect(regionsTouching(partition, { x: -400, y: -400, w: 100, h: 100 })).toEqual([])
  })
})

describe('landingAt', () => {
  const partition = partitionPage(PAGE, BOXES, 0.15)
  const offsetOf = offsetsOf(partition, 0.3)

  it('is the exact inverse for a point a piece is showing', () => {
    expect(partition.regions.length).toBeGreaterThan(1)
    partition.regions.forEach((_, r) => {
      const p = pointIn(partition, r)
      const offset = offsetOf(r)
      const landing = landingAt(partition, { x: p.x + offset.x, y: p.y + offset.y }, offsetOf)
      expect(landing.region).toBe(r)
      expect(landing.point.x).toBeCloseTo(p.x, 9)
      expect(landing.point.y).toBeCloseTo(p.y, 9)
    })
  })

  it('puts a point let go over a gap on the piece nearest it', () => {
    const shows = (shown: { x: number; y: number }) =>
      partition.regions.some((_, r) => {
        const offset = offsetOf(r)
        return regionAt(partition, shown.x - offset.x, shown.y - offset.y) === r
      })
    const gaps: { x: number; y: number }[] = []
    for (let x = 0; x < PAGE.w; x += 7)
      for (let y = 0; y < PAGE.h; y += 11) {
        const shown = { x, y }
        if (!shows(shown)) gaps.push(shown)
      }
    expect(gaps.length).toBeGreaterThan(0)
    for (const shown of gaps) {
      const landing = landingAt(partition, shown, offsetOf)
      const offset = offsetOf(landing.region)
      // On the page, on the piece it was given to, and never further from where
      // it was let go than the gap it was let go over.
      expect(regionAt(partition, landing.point.x, landing.point.y)).toBe(landing.region)
      const away = Math.hypot(landing.point.x + offset.x - shown.x, landing.point.y + offset.y - shown.y)
      expect(away).toBeLessThan(Math.max(PAGE.w, PAGE.h) * 0.3)
    }
  })

  it('leaves a point beyond the page outside it, through the nearest piece', () => {
    const landing = landingAt(partition, { x: -300, y: -300 }, offsetOf)
    const offset = offsetOf(landing.region)
    expect(landing.point.x).toBeCloseTo(-300 - offset.x, 9)
    expect(landing.point.y).toBeCloseTo(-300 - offset.y, 9)
    expect(regionAt(partition, landing.point.x, landing.point.y)).toBe(-1)
  })

  it('gives the point back untouched while the page is whole', () => {
    const whole = partitionPage(PAGE, BOXES, 1)
    const landing = landingAt(whole, { x: 123, y: 456 }, () => ({ x: 0, y: 0 }))
    expect(landing).toEqual({ region: 0, point: { x: 123, y: 456 } })
  })
})
