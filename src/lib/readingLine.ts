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
