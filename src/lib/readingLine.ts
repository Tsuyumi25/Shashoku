import { turnedAround } from '@/lib/coords'
import type { Point } from '@/lib/labelBox'

/**
 * One object as a line has to see it: where its frame stands, how big it is,
 * and which way it is lying. All in page pixels.
 *
 * A line stores neither end's geometry — only two ids — so every coordinate
 * here is worked out afresh from where the objects are standing now. That is
 * what makes moving an object take its lines with it and write nothing.
 */
export interface FrameBox {
  center: Point
  w: number
  h: number
  rotation: number
}

export interface ReadingLine {
  a: Point
  b: Point
}

const ORIGIN: Point = { x: 0, y: 0 }

/**
 * The four places a line can meet a frame: the midpoint of each edge, turned
 * with the object.
 *
 * Four and not a point anywhere along the edge, which is what the reference
 * implementation this borrows from settled on. A continuous landing point
 * slides as either object is nudged, so a page of lines shifts underfoot while
 * the objects are being placed; four fixed places mean a line's ends only
 * change when the objects change which side they are on.
 */
export function edgeAnchors(box: FrameBox): Point[] {
  const half = { x: box.w / 2, y: box.h / 2 }
  return [
    { x: 0, y: -half.y },
    { x: half.x, y: 0 },
    { x: 0, y: half.y },
    { x: -half.x, y: 0 },
  ].map((local) => {
    const out = turnedAround(ORIGIN, local, box.rotation)
    return { x: box.center.x + out.x, y: box.center.y + out.y }
  })
}

/** Whichever of the four lies closest to what is being reached for. */
export function nearestAnchor(box: FrameBox, toward: Point): Point {
  let best = { at: ORIGIN, away: Number.POSITIVE_INFINITY }
  for (const at of edgeAnchors(box)) {
    const away = Math.hypot(at.x - toward.x, at.y - toward.y)
    if (away < best.away) best = { at, away }
  }
  return best.at
}

/**
 * The line between two objects, edge to edge. It always answers.
 *
 * ⚠️ Two frames that overlap get a line whose ends are on their inward-facing
 * edges, so it runs against the way the objects lie and reads oddly. That is
 * on purpose: a line the file holds and the canvas declines to draw cannot be
 * found or removed, while one that looks wrong says out loud that two objects
 * are sitting on top of each other.
 */
export function readingLineBetween(from: FrameBox, to: FrameBox): ReadingLine {
  return {
    a: nearestAnchor(from, to.center),
    b: nearestAnchor(to, from.center),
  }
}

/** How far a point lies from a segment, for deciding whether a click hit it. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const along = { x: b.x - a.x, y: b.y - a.y }
  const lengthSq = along.x * along.x + along.y * along.y
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * along.x + (p.y - a.y) * along.y) / lengthSq),
  )
  return Math.hypot(p.x - (a.x + along.x * t), p.y - (a.y + along.y * t))
}

/**
 * The control point that bows a line outward: off its middle, to the left of
 * the way it runs, by a share of its length. Lines leaving one object for two
 * others bow apart instead of lying on top of each other.
 */
export function bowOf(line: ReadingLine): Point {
  const dx = line.b.x - line.a.x
  const dy = line.b.y - line.a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return line.a
  const bow = Math.min(length * 0.18, 220)
  return {
    x: (line.a.x + line.b.x) / 2 - (dy / length) * bow,
    y: (line.a.y + line.b.y) / 2 + (dx / length) * bow,
  }
}

export function pointOnBow(line: ReadingLine, control: Point, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * line.a.x + 2 * u * t * control.x + t * t * line.b.x,
    y: u * u * line.a.y + 2 * u * t * control.y + t * t * line.b.y,
  }
}

/** How far a point lies from the bowed line, for deciding whether a click hit the curve as drawn. */
export function distanceToBow(p: Point, line: ReadingLine, control: Point): number {
  const STEPS = 24
  let nearest = Number.POSITIVE_INFINITY
  let previous = line.a
  for (let step = 1; step <= STEPS; step++) {
    const next = pointOnBow(line, control, step / STEPS)
    nearest = Math.min(nearest, distanceToSegment(p, previous, next))
    previous = next
  }
  return nearest
}

/**
 * Which chain each line belongs to, numbered from 0 in the order their first
 * objects are read. A chain runs on through an object with exactly one line in
 * and one line out; a fork starts a new chain on each branch and a merge starts
 * one after it, so a branch is told apart from the line it left.
 */
export function chainsOf(
  edges: readonly { from: string; to: string }[],
  order: readonly string[],
): Map<string, number> {
  const ins = new Map<string, number>()
  const outs = new Map<string, { from: string; to: string }[]>()
  for (const edge of edges) {
    ins.set(edge.to, (ins.get(edge.to) ?? 0) + 1)
    outs.set(edge.from, [...(outs.get(edge.from) ?? []), edge])
  }
  const keyOf = (edge: { from: string; to: string }) => JSON.stringify([edge.from, edge.to])
  const continues = (edge: { from: string; to: string }) =>
    ins.get(edge.from) === 1 && outs.get(edge.from)!.length === 1
  const place = new Map(order.map((id, at) => [id, at]))
  const starts = edges
    .filter((edge) => !continues(edge))
    .sort((x, y) => (place.get(x.from) ?? Infinity) - (place.get(y.from) ?? Infinity))
  const chain = new Map<string, number>()
  starts.forEach((start, n) => {
    let edge: { from: string; to: string } | undefined = start
    while (edge !== undefined && !chain.has(keyOf(edge))) {
      chain.set(keyOf(edge), n)
      const next: { from: string; to: string }[] = outs.get(edge.to) ?? []
      edge = next.length === 1 && continues(next[0]!) ? next[0] : undefined
    }
  })
  // A ring with no way in has no start; it still needs a colour.
  let next = starts.length
  for (const edge of edges) if (!chain.has(keyOf(edge))) chain.set(keyOf(edge), next++)
  return chain
}
