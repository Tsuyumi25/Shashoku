import type { Anchor } from '@/lib/coords'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Region {
  /**
   * The point the region is pushed away from, and the point it is shrunk
   * toward: one it is star-shaped about wherever it has one.
   */
  anchor: Anchor
  /** One rectangle per run of cells along a grid row, in page pixels. */
  runs: readonly Rect[]
  /** Share of the page this region covers, 0…1. */
  area: number
}

export interface Partition {
  page: { w: number; h: number }
  step: number
  gw: number
  gh: number
  /** Which region owns each cell, row-major. */
  cells: Int16Array
  regions: readonly Region[]
}

/**
 * How fine the grid is, in page pixels. Page-relative so the cut costs the same
 * on a 1200-pixel scan as on a 4000-pixel one.
 */
export function stepFor(page: { w: number; h: number }): number {
  return Math.max(2, Math.round(Math.max(page.w, page.h) / 400))
}

function dedupe(boxes: readonly Rect[]): Rect[] {
  const seen = new Set<string>()
  const out: Rect[] = []
  for (const b of boxes) {
    const rect = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }
    const key = `${rect.x},${rect.y},${rect.w},${rect.h}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(rect)
  }
  return out
}

/** Which region a page point falls in, or -1 off the page. */
export function regionAt(partition: Partition, x: number, y: number): number {
  const gx = Math.floor(x / partition.step)
  const gy = Math.floor(y / partition.step)
  if (gx < 0 || gy < 0 || gx >= partition.gw || gy >= partition.gh) return -1
  return partition.cells[gy * partition.gw + gx]
}

/**
 * Which regions a rectangle of the page is drawn on, the one holding its
 * middle first. Empty for a rectangle wholly off the page.
 */
export function regionsTouching(partition: Partition, box: Rect): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  const home = regionAt(partition, box.x + box.w / 2, box.y + box.h / 2)
  if (home >= 0) {
    out.push(home)
    seen.add(home)
  }
  const gx0 = Math.max(0, Math.floor(box.x / partition.step))
  const gx1 = Math.min(partition.gw - 1, Math.floor((box.x + box.w) / partition.step))
  const gy0 = Math.max(0, Math.floor(box.y / partition.step))
  const gy1 = Math.min(partition.gh - 1, Math.floor((box.y + box.h) / partition.step))
  for (let gy = gy0; gy <= gy1 && seen.size < partition.regions.length; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const region = partition.cells[gy * partition.gw + gx]
      if (seen.has(region)) continue
      seen.add(region)
      out.push(region)
    }
  }
  return out
}

/**
 * The overlap `assemble` leaves between neighbouring runs, and a hair further
 * in again so that a point put on a run's far edge still reads back as that
 * run's own region rather than as its neighbour's.
 */
const SEAM = 0.25
const INSIDE = 1e-6

/** The point of one region nearest a page point, and how far away that is. */
function nearestOnRegion(region: Region, p: Anchor): { point: Anchor; away: number } {
  let best = { point: p, away: Infinity }
  for (const run of region.runs) {
    const x = Math.min(Math.max(p.x, run.x), run.x + run.w - SEAM - INSIDE)
    const y = Math.min(Math.max(p.y, run.y + SEAM), run.y + run.h - SEAM - INSIDE)
    const away = Math.hypot(x - p.x, y - p.y)
    if (away < best.away) best = { point: { x, y }, away }
  }
  return best
}

/** Where a point of the page as it is shown lands on the page itself. */
export interface Landing {
  /** The piece that was showing it, or the piece it was pulled onto. */
  region: number
  point: Anchor
}

/**
 * The explosion undone: the piece whose window a shown point falls in, and the
 * point of the page under it.
 *
 * ⭐ The gaps are the one thing this inverse has to answer for. They are
 * nowhere on the page — the page is covered by the regions and the gaps are
 * what pushing them apart opened up — so a point let go over one is given the
 * nearest point of the nearest piece. Off the page is not a gap: there was
 * never anything there to be pulled onto, and the gutter is where something
 * parked outside the page is meant to stay.
 */
export function landingAt(
  partition: Partition,
  shown: Anchor,
  offsetOf: (region: number) => Anchor,
): Landing {
  let best: { region: number; point: Anchor; raw: Anchor; away: number } | null = null
  for (let r = 0; r < partition.regions.length; r++) {
    const offset = offsetOf(r)
    const raw = { x: shown.x - offset.x, y: shown.y - offset.y }
    if (regionAt(partition, raw.x, raw.y) === r) return { region: r, point: raw }
    const near = nearestOnRegion(partition.regions[r], raw)
    if (best === null || near.away < best.away) {
      best = { region: r, point: near.point, raw, away: near.away }
    }
  }
  if (best === null) return { region: -1, point: shown }
  const offPage = regionAt(partition, best.raw.x, best.raw.y) === -1
  return { region: best.region, point: offPage ? best.raw : best.point }
}

function wholePage(page: { w: number; h: number }): Partition {
  const step = stepFor(page)
  const gw = Math.max(1, Math.ceil(page.w / step))
  const gh = Math.max(1, Math.ceil(page.h / step))
  return {
    page,
    step,
    gw,
    gh,
    cells: new Int16Array(gw * gh),
    regions: [
      {
        anchor: { x: page.w / 2, y: page.h / 2 },
        runs: [{ x: 0, y: 0, w: page.w, h: page.h }],
        area: 1,
      },
    ],
  }
}

/**
 * The page cut into regions no OCR box straddles, merged up to `capShare` of
 * the page's area.
 *
 * Seeds are the boxes, with any pair within one cell of each other taken as
 * one: a cell between two such boxes could go either way, and whichever way it
 * went would cut the other box.
 */
export function partitionPage(
  page: { w: number; h: number },
  boxes: readonly Rect[],
  capShare: number,
): Partition {
  if (page.w <= 0 || page.h <= 0) return wholePage({ w: Math.max(1, page.w), h: Math.max(1, page.h) })
  const rects = dedupe(boxes)
  if (rects.length === 0) return wholePage(page)

  const step = stepFor(page)
  const gw = Math.ceil(page.w / step)
  const gh = Math.ceil(page.h / step)

  const parent = rects.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const near = (a: Rect, b: Rect) =>
    Math.min(a.x + a.w, b.x + b.w) + step > Math.max(a.x, b.x) &&
    Math.min(a.y + a.h, b.y + b.h) + step > Math.max(a.y, b.y)
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) if (near(rects[i], rects[j])) parent[find(j)] = find(i)
  const seedIds = new Map<number, number>()
  const seedOf = rects.map((_, i) => {
    const root = find(i)
    if (!seedIds.has(root)) seedIds.set(root, seedIds.size)
    return seedIds.get(root)!
  })
  const seeds = seedIds.size

  const owner = new Int16Array(gw * gh)
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * step
      const y0 = gy * step
      const x1 = x0 + step
      const y1 = y0 + step
      let best = 0
      let nearest = Infinity
      for (let i = 0; i < rects.length; i++) {
        const b = rects[i]
        const dx = Math.max(b.x - x1, 0, x0 - (b.x + b.w))
        const dy = Math.max(b.y - y1, 0, y0 - (b.y + b.h))
        const d = dx * dx + dy * dy
        if (d < nearest) {
          nearest = d
          best = seedOf[i]
        }
      }
      owner[gy * gw + gx] = best
    }

  const seedArea = new Array<number>(seeds).fill(0)
  for (const o of owner) seedArea[o]++

  const touching = new Set<number>()
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const a = owner[gy * gw + gx]
      if (gx + 1 < gw) {
        const b = owner[gy * gw + gx + 1]
        if (b !== a) touching.add(Math.min(a, b) * seeds + Math.max(a, b))
      }
      if (gy + 1 < gh) {
        const b = owner[(gy + 1) * gw + gx]
        if (b !== a) touching.add(Math.min(a, b) * seeds + Math.max(a, b))
      }
    }

  const visibility = visibilityGrid(page, owner, step, gw, gh, seeds)
  const merged = mergeSeeds(seeds, seedArea, touching, gw * gh * capShare, capShare < 1 ? visibility : null)
  return assemble(page, step, gw, gh, owner, merged, visibility, capShare)
}

interface Visibility {
  cw: number
  ch: number
  cs: number
  seedAt: Int16Array
  cellsOfSeed: number[][]
  /** A point the union of these seeds is star-shaped about, in page pixels. */
  kernelPoint(members: readonly number[]): Anchor | null
}

/**
 * Exploding by k is the page scaled by 1+k with every region shrunk by 1/(1+k)
 * toward its anchor. A region shrunk toward a point it is star-shaped about
 * stays inside itself, so regions all star-shaped about their anchors never
 * overlap.
 */
function visibilityGrid(
  page: { w: number; h: number },
  owner: Int16Array,
  step: number,
  gw: number,
  gh: number,
  seeds: number,
): Visibility {
  const cs = Math.max(4, Math.round(Math.max(page.w, page.h) / 150))
  const cw = Math.ceil(page.w / cs)
  const ch = Math.ceil(page.h / cs)
  const seedAt = new Int16Array(cw * ch)
  const cellsOfSeed: number[][] = Array.from({ length: seeds }, () => [])
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      const gx = Math.min(gw - 1, Math.floor(((cx + 0.5) * cs) / step))
      const gy = Math.min(gh - 1, Math.floor(((cy + 0.5) * cs) / step))
      const seed = owner[gy * gw + gx]
      seedAt[cy * cw + cx] = seed
      cellsOfSeed[seed].push(cy * cw + cx)
    }

  function kernelPoint(members: readonly number[]): Anchor | null {
    const mine = new Set(members)
    const inside = (cx: number, cy: number) =>
      cx >= 0 && cy >= 0 && cx < cw && cy < ch && mine.has(seedAt[cy * cw + cx])
    const cells = members.flatMap((seed) => cellsOfSeed[seed])
    if (cells.length === 0) return null
    let mx = 0
    let my = 0
    for (const c of cells) {
      mx += c % cw
      my += Math.floor(c / cw)
    }
    mx /= cells.length
    my /= cells.length
    // Without holes, seeing every boundary cell is seeing all of it.
    const boundary = cells.filter((c) => {
      const cx = c % cw
      const cy = Math.floor(c / cw)
      return !inside(cx + 1, cy) || !inside(cx - 1, cy) || !inside(cx, cy + 1) || !inside(cx, cy - 1)
    })
    const sees = (ax: number, ay: number) =>
      boundary.every((c) => {
        const bx = (c % cw) + 0.5
        const by = Math.floor(c / cw) + 0.5
        const steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2)
        for (let i = 1; i < steps; i++) {
          const t = i / steps
          if (!inside(Math.floor(ax + (bx - ax) * t), Math.floor(ay + (by - ay) * t))) return false
        }
        return true
      })
    // Nearest the centroid first, so the anchor stays as central as it can.
    const stride = Math.max(1, Math.floor(cells.length / 40))
    const candidates = cells
      .filter((_, i) => i % stride === 0)
      .map((c) => ({ x: (c % cw) + 0.5, y: Math.floor(c / cw) + 0.5 }))
      .sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my))
      .slice(0, 24)
    for (const a of candidates) if (sees(a.x, a.y)) return { x: a.x * cs, y: a.y * cs }
    return null
  }

  return { cw, ch, cs, seedAt, cellsOfSeed, kernelPoint }
}

interface Merged {
  regionOfSeed: number[]
  count: number
  seedsOfRegion: number[][]
}

/**
 * The smallest pair first, for as long as the pair fits under the cap. A merge
 * that would leave nothing to shrink toward is refused and the next smallest
 * tried — the star-shape is what keeps the regions from overlapping once they
 * are pushed apart.
 */
function mergeSeeds(
  seeds: number,
  seedArea: readonly number[],
  touching: ReadonlySet<number>,
  cap: number,
  visibility: Visibility | null,
): Merged {
  const parent = Array.from({ length: seeds }, (_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const size = [...seedArea]
  const members: number[][] = Array.from({ length: seeds }, (_, i) => [i])
  const refused = new Set<number>()
  for (;;) {
    let best: { a: number; b: number; area: number } | null = null
    for (const pair of touching) {
      const a = find(Math.floor(pair / seeds))
      const b = find(pair % seeds)
      if (a === b || refused.has(Math.min(a, b) * seeds + Math.max(a, b))) continue
      const area = size[a] + size[b]
      if (area <= cap && (best === null || area < best.area)) best = { a, b, area }
    }
    if (best === null) break
    if (visibility && !visibility.kernelPoint([...members[best.a], ...members[best.b]])) {
      refused.add(Math.min(best.a, best.b) * seeds + Math.max(best.a, best.b))
      continue
    }
    parent[best.b] = best.a
    size[best.a] = best.area
    members[best.a] = [...members[best.a], ...members[best.b]]
  }
  const ids = new Map<number, number>()
  const regionOfSeed = Array.from({ length: seeds }, (_, seed) => {
    const root = find(seed)
    if (!ids.has(root)) ids.set(root, ids.size)
    return ids.get(root)!
  })
  const seedsOfRegion: number[][] = Array.from({ length: ids.size }, () => [])
  regionOfSeed.forEach((region, seed) => seedsOfRegion[region].push(seed))
  return { regionOfSeed, count: ids.size, seedsOfRegion }
}

function assemble(
  page: { w: number; h: number },
  step: number,
  gw: number,
  gh: number,
  owner: Int16Array,
  merged: Merged,
  visibility: Visibility,
  capShare: number,
): Partition {
  const { regionOfSeed, count, seedsOfRegion } = merged
  const cells = new Int16Array(gw * gh)
  const sx = new Float64Array(count)
  const sy = new Float64Array(count)
  const held = new Float64Array(count)
  const runs: Rect[][] = Array.from({ length: count }, () => [])
  for (let gy = 0; gy < gh; gy++) {
    let start = 0
    let run = regionOfSeed[owner[gy * gw]]
    for (let gx = 0; gx <= gw; gx++) {
      const region = gx < gw ? regionOfSeed[owner[gy * gw + gx]] : -1
      if (gx < gw) {
        cells[gy * gw + gx] = region
        sx[region] += gx
        sy[region] += gy
        held[region]++
      }
      if (region !== run) {
        // A hair of overlap, or neighbouring rows of one region leave a seam
        // between them once the blit is drawn at a fractional scale.
        runs[run].push({
          x: start * step,
          y: gy * step - 0.25,
          w: (gx - start) * step + 0.25,
          h: step + 0.5,
        })
        start = gx
        run = region
      }
    }
  }
  const regions: Region[] = []
  for (let r = 0; r < count; r++) {
    const centroid = { x: (sx[r] / held[r] + 0.5) * step, y: (sy[r] / held[r] + 0.5) * step }
    const kernel = count === 1 || capShare >= 1 ? null : visibility.kernelPoint(seedsOfRegion[r])
    regions.push({ anchor: kernel ?? centroid, runs: runs[r], area: held[r] / (gw * gh) })
  }
  return { page, step, gw, gh, cells, regions }
}
