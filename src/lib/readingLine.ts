import { turnedAround } from '@/lib/coords'
import { samplePath, shortestDubins, toPoint, type Pose } from '@/lib/dubins'
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
export function nearestAnchor(box: FrameBox, toward: Point, taken: readonly Point[] = [], keepAway = 0): Point {
  const free = (at: Point) => taken.every((t) => Math.hypot(at.x - t.x, at.y - t.y) >= keepAway)
  let best = { at: ORIGIN, away: Number.POSITIVE_INFINITY, free: false }
  for (const at of edgeAnchors(box)) {
    const away = Math.hypot(at.x - toward.x, at.y - toward.y)
    const open = free(at)
    // A free anchor beats a taken one however far; only among equals does distance decide.
    if ((open && !best.free) || (open === best.free && away < best.away)) best = { at, away, free: open }
  }
  return best.at
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
 * The path a line is drawn along: a short straight launch out of its edge, the
 * shortest turn-and-straight to the start of the landing, a short straight
 * into the other edge. Held as points, since nothing about it is one curve.
 */
export interface LineRoute {
  a: Point
  b: Point
  points: readonly Point[]
  /** Which way the line is travelling as it reaches `b`, a unit vector. */
  arrive: Point
  length: number
}

/** How far a line runs straight out of its edge before it may turn, in line widths. */
const LAUNCH_WIDTHS = 3
/** The tightest a line may turn, as a radius in line widths. */
const TURN_WIDTHS = 6

/** Straight out of `box` through the anchor `at`: the edge's outward normal, turned with the object. */
function outwardOf(box: FrameBox, at: Point): Point {
  const ox = at.x - box.center.x
  const oy = at.y - box.center.y
  const o = Math.hypot(ox, oy) || 1
  return { x: ox / o, y: oy / o }
}

function launchPose(at: Point, out: Point, width: number): Pose {
  const reach = width * LAUNCH_WIDTHS
  return { x: at.x + out.x * reach, y: at.y + out.y * reach, heading: Math.atan2(out.y, out.x) }
}

/**
 * Out of an edge and on to a loose point — the line being drawn, whose far end
 * is the pointer and has no edge to land on. It arrives travelling straight at
 * the pointer from where its launch ended.
 */
export function launchedRoute(from: FrameBox, a: Point, b: Point, width: number): LineRoute {
  const start = launchPose(a, outwardOf(from, a), width)
  const toward = Math.atan2(b.y - start.y, b.x - start.x)
  const path = shortestDubins(start, { x: b.x, y: b.y, heading: toward }, width * TURN_WIDTHS)
  return {
    a,
    b,
    points: [a, ...samplePath(path).map(toPoint)],
    arrive: { x: Math.cos(toward), y: Math.sin(toward) },
    length: width * LAUNCH_WIDTHS + path.length,
  }
}

/** Whether a point lies inside a frame, its edge excluded. */
function inside(box: FrameBox, p: Point): boolean {
  const local = turnedAround(ORIGIN, { x: p.x - box.center.x, y: p.y - box.center.y }, -box.rotation)
  return Math.abs(local.x) < box.w / 2 - 0.5 && Math.abs(local.y) < box.h / 2 - 0.5
}

/** Out of `a` at right angles to its edge, into `b` at right angles to its. */
function pairedRoute(from: FrameBox, a: Point, to: FrameBox, b: Point, width: number): LineRoute {
  const outB = outwardOf(to, b)
  const landing = launchPose(b, outB, width)
  const path = shortestDubins(
    launchPose(a, outwardOf(from, a), width),
    { ...landing, heading: landing.heading + Math.PI },
    width * TURN_WIDTHS,
  )
  return {
    a,
    b,
    points: [a, ...samplePath(path).map(toPoint), b],
    arrive: { x: -outB.x, y: -outB.y },
    length: width * LAUNCH_WIDTHS * 2 + path.length,
  }
}

/**
 * How long a route runs, or Infinity where it cuts back through either of its
 * own frames — the sign that its ends were put on the wrong edges.
 */
function costOf(route: LineRoute, from: FrameBox, to: FrameBox): number {
  const between = route.points.slice(1, -1)
  return between.some((p) => inside(from, p) || inside(to, p)) ? Number.POSITIVE_INFINITY : route.length
}

/**
 * The line between two objects as drawn.
 *
 * Both ends are settled before the line between them is: each leaves or
 * arrives at right angles to its edge, and what runs between the two launches
 * is the shortest path that never turns tighter than a set radius — so it is
 * smooth by construction, with no corner anywhere along it. Among every pair
 * of edges the one kept is the shortest whose path stays out of both frames.
 * Facing edges win when the objects stand apart; set close, the launches meet
 * head on and the path between them has to loop, and the pair that wins is
 * one that goes round the outside.
 *
 * ⚠️ It always answers, even for frames that overlap and have no clean pair:
 * the first pair is kept, and a line that looks wrong says out loud that two
 * objects sit on top of each other, where a line the canvas declined to draw
 * could be neither found nor removed.
 */
export function routeBetween(
  from: FrameBox,
  to: FrameBox,
  width: number,
  /**
   * Where other lines arrive on `from`. A line setting out from the same spot
   * reads as one line running through, so it leaves from another edge.
   */
  arrivals: readonly Point[] = [],
  /** Where this line has already been settled to arrive, when only its start is still open. */
  arrival?: Point,
): LineRoute {
  const keepAway = width * 4
  const starts = edgeAnchors(from)
  const free = starts.filter((at) => arrivals.every((t) => Math.hypot(at.x - t.x, at.y - t.y) >= keepAway))
  const ends = arrival === undefined ? edgeAnchors(to) : [arrival]
  let best: { route: LineRoute; cost: number } | null = null
  for (const a of free.length > 0 ? free : starts)
    for (const b of ends) {
      const route = pairedRoute(from, a, to, b, width)
      const cost = costOf(route, from, to)
      // Strictly less, so a tie goes to the edge listed first and the choice holds still.
      if (best === null || cost < best.cost) best = { route, cost }
    }
  return best!.route
}

/** How far a point lies from the route as drawn, for deciding whether a click hit it. */
export function distanceToRoute(p: Point, points: readonly Point[]): number {
  let nearest = Number.POSITIVE_INFINITY
  for (let at = 1; at < points.length; at++) nearest = Math.min(nearest, distanceToSegment(p, points[at - 1]!, points[at]!))
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
