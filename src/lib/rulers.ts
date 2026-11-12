import type { ViewTransform } from '@/lib/coords'
import type { PageGuide } from '@shared/page/types'

/** How thick the rulers stand along the canvas's top and left edges, in screen pixels. */
export const RULER_PX = 18

/** How near a guide or a snap target has to come before it takes hold, in screen pixels. */
export const SNAP_PX = 8

/**
 * The view the rulers measure with: the canvas's, turned back upright about the
 * middle of the canvas, which is where turning the view pivots. Zooming and
 * panning move it; turning the view does not, so the rulers keep still while
 * the page turns under them and agree with the page exactly when it is upright.
 */
export function levelView(view: ViewTransform, container: { w: number; h: number }): ViewTransform {
  if (view.rotate === 0) return view
  const mx = container.w / 2
  const my = container.h / 2
  const cos = Math.cos(view.rotate)
  const sin = Math.sin(view.rotate)
  // The page point under the middle, from `screen = t + s·R(θ)·page`.
  const ix = (mx - view.tx) / view.scale
  const iy = (my - view.ty) / view.scale
  const px = ix * cos + iy * sin
  const py = -ix * sin + iy * cos
  return { scale: view.scale, rotate: 0, tx: mx - view.scale * px, ty: my - view.scale * py }
}

/**
 * The spacing of a ruler's numbered ticks and of the small ticks between them,
 * in page pixels: the smallest of 1, 2 and 5 times a power of ten that leaves
 * numbered ticks at least 60 screen pixels apart, split in tenths — which then
 * stand at least 6 screen pixels apart.
 */
export function rulerSteps(scale: number): { major: number; minor: number } {
  const want = 60 / scale
  const power = 10 ** Math.floor(Math.log10(want))
  const major = [1, 2, 5, 10].map((k) => k * power).find((step) => step >= want) ?? 10 * power
  return { major, minor: major / 10 }
}

/**
 * The value among `candidates` nearest `value`, if one lies within `reach`;
 * ties go to the earlier candidate.
 */
export function nearestWithin(value: number, candidates: readonly number[], reach: number): number | null {
  let best: number | null = null
  let bestGap = reach
  for (const c of candidates) {
    const gap = Math.abs(c - value)
    if (gap <= bestGap && (best === null || gap < bestGap)) {
      best = c
      bestGap = gap
    }
  }
  return best
}

/** Lines a dragged box can take hold of, in page pixels: `x` are vertical lines, `y` horizontal. */
export interface SnapLines {
  x: readonly number[]
  y: readonly number[]
}

/** The page's guides as the lines they draw. */
export function linesOfGuides(guides: readonly PageGuide[]): SnapLines {
  return {
    x: guides.filter((g) => g.orientation === 'vertical').map((g) => g.position),
    y: guides.filter((g) => g.orientation === 'horizontal').map((g) => g.position),
  }
}

/** The six lines of a box: its edges and its middle on each axis. */
export function linesOfBox(box: { x: number; y: number; w: number; h: number }): { x: number[]; y: number[] } {
  return { x: [box.x, box.x + box.w / 2, box.x + box.w], y: [box.y, box.y + box.h / 2, box.y + box.h] }
}

/**
 * How far a box has to move for one of its three lines on each axis to lie on
 * one of `targets`, taking the nearest within `reach` on each axis on its own,
 * and which target it took — zero and null on an axis with none in reach.
 */
export function snapBox(
  box: { x: number; y: number; w: number; h: number },
  targets: SnapLines,
  reach: number,
): { dx: number; dy: number; x: number | null; y: number | null } {
  const along = (lines: readonly number[], candidates: readonly number[]) => {
    let move = 0
    let gap = reach
    let onto: number | null = null
    for (const target of candidates) {
      for (const line of lines) {
        const d = Math.abs(target - line)
        if (d <= gap && (onto === null || d < gap)) {
          move = target - line
          gap = d
          onto = target
        }
      }
    }
    return { move, onto }
  }
  const own = linesOfBox(box)
  const across = along(own.x, targets.x)
  const down = along(own.y, targets.y)
  return { dx: across.move, dy: down.move, x: across.onto, y: down.onto }
}

/** A stretch of line on the page, in page pixels. */
export interface Segment {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * What a box that has just taken hold of `held` shows, as Photoshop draws its
 * smart guides: a line from the box to the nearest other box sharing that line,
 * or one across the page and no further for a line of the page itself. Nothing
 * on an axis that took no hold, or took it on a line neither has.
 */
export function smartSegments(
  moved: Box,
  held: { x: number | null; y: number | null },
  boxes: readonly Box[],
  page: { w: number; h: number },
): Segment[] {
  const same = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, b0 - a1, a0 - b1)
  const out: Segment[] = []
  if (held.x !== null) {
    const x = held.x
    const sharing = boxes.filter((b) => linesOfBox(b).x.some((l) => same(l, x)))
    const near = nearestBy(sharing, (b) => gap(moved.y, moved.y + moved.h, b.y, b.y + b.h))
    if (near) {
      out.push({ x1: x, y1: Math.min(moved.y, near.y), x2: x, y2: Math.max(moved.y + moved.h, near.y + near.h) })
    } else if ([0, page.w / 2, page.w].some((l) => same(l, x))) out.push({ x1: x, y1: 0, x2: x, y2: page.h })
  }
  if (held.y !== null) {
    const y = held.y
    const sharing = boxes.filter((b) => linesOfBox(b).y.some((l) => same(l, y)))
    const near = nearestBy(sharing, (b) => gap(moved.x, moved.x + moved.w, b.x, b.x + b.w))
    if (near) {
      out.push({ x1: Math.min(moved.x, near.x), y1: y, x2: Math.max(moved.x + moved.w, near.x + near.w), y2: y })
    } else if ([0, page.h / 2, page.h].some((l) => same(l, y))) out.push({ x1: 0, y1: y, x2: page.w, y2: y })
  }
  return out
}

function nearestBy<T>(items: readonly T[], distance: (item: T) => number): T | null {
  let best: T | null = null
  let bestDistance = Infinity
  for (const item of items) {
    const d = distance(item)
    if (d < bestDistance) {
      best = item
      bestDistance = d
    }
  }
  return best
}
