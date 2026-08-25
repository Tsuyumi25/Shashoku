/**
 * A place is somewhere on the artwork that was read, and everything that was
 * read there.
 *
 * ⭐ Worked out on every ask and never stored. A place is a reading *of* the
 * pool, so the pool growing by one entry expires every answer given about it —
 * storing them would mean a page whose places disagreed with its own readings.
 *
 * All the readings of one region share that region's box, so a place is usually
 * exactly one region. It is not the same thing as one, though: a region is what
 * a detector proposed on one run, and a place is what the page holds now,
 * including whatever earlier runs left behind.
 */
import type { OcrCandidatePersisted } from '../page/types'

/**
 * How much of each box the other has to cover before they are one place.
 *
 * ⭐ Asked of **both** boxes, which is the whole of the rule. Neither weaker
 * test survives a real page:
 *
 * "any overlap at all" strings the page into a single place, because that is
 * what a caption running the full width does — it clips every balloon it
 * crosses, and one effect drawn across three panels does the same.
 *
 * "one contains the other" has the opposite failure. A small balloon sitting
 * wholly inside a big sound effect is shaped exactly like a genuine nesting and
 * means the opposite of one.
 *
 * ⚠️ Descriptive rather than measured, like the column share on the far side.
 * If a page's line breaks come out visibly wrong, this is one of the first two
 * numbers to look at — before anything in the transplant.
 */
export const SAME_PLACE = 0.5

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Place extends Box {
  /** Everything read here, in the order the pool holds it. */
  readings: OcrCandidatePersisted[]
}

export function placesIn(pool: readonly OcrCandidatePersisted[]): Place[] {
  return groupsOf(pool, (r) => r).map((readings) => ({ ...union(readings), readings }))
}

/**
 * The same grouping over anything that has a box, for callers holding readings
 * that are not in a pool yet.
 *
 * `boxOf` rather than a box on the item, because a reading on the wire measures
 * itself in `width`/`height` and one in a pool in `w`/`h` — one shape had to
 * give, and neither is wrong where it lives.
 */
export function groupsOf<T>(items: readonly T[], boxOf: (item: T) => Box): T[][] {
  const home = items.map((_, at) => at)
  const rootOf = (at: number): number => {
    let root = at
    while (home[root] !== root) root = home[root]
    while (home[at] !== root) [at, home[at]] = [home[at], root]
    return root
  }

  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      if (!samePlace(boxOf(items[a]), boxOf(items[b]))) continue
      const [ra, rb] = [rootOf(a), rootOf(b)]
      // Joined to the lower index, so the answer does not depend on which of
      // two roots happened to be reached first.
      if (ra !== rb) home[Math.max(ra, rb)] = Math.min(ra, rb)
    }
  }

  const groups = new Map<number, T[]>()
  items.forEach((item, at) => {
    const root = rootOf(at)
    const standing = groups.get(root)
    if (standing) standing.push(item)
    else groups.set(root, [item])
  })
  return [...groups.values()]
}

export function samePlace(a: Box, b: Box): boolean {
  const wide = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const tall = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const both = wide * tall
  if (both === 0) return false
  const areaA = a.w * a.h
  const areaB = b.w * b.h
  if (areaA === 0 || areaB === 0) return false
  return both / areaA >= SAME_PLACE && both / areaB >= SAME_PLACE
}

function union(boxes: readonly Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return {
    x,
    y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  }
}

export interface Point {
  x: number
  y: number
}

/**
 * Near enough means inside the circle that just contains the box — scale-free
 * where a pixel threshold is not (pages here run from eighteen hundred across
 * to five thousand), and slightly wider than the box on purpose: the box hugs
 * the ink, and somebody placing an object in a balloon aims at the balloon.
 */
export function nearEnough(centre: Point, box: Box): boolean {
  return distanceTo(centre, box) <= Math.hypot(box.w, box.h) / 2
}

/** Centre to centre. A text object has no frame of its own to compare edges with. */
export function distanceTo(centre: Point, box: Box): number {
  return Math.hypot(centre.x - (box.x + box.w / 2), centre.y - (box.y + box.h / 2))
}
