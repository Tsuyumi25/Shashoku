import { turnedAround } from '@/lib/coords'
import { angleDelta, type Point } from '@/lib/labelBox'

/** One member of a multiple selection, as the frame around it stands on the page. */
export interface MemberFrame {
  center: Point
  w: number
  h: number
  rotation: number
}

export interface GroupBox {
  centerX: number
  centerY: number
  width: number
  height: number
}

/** Where a member's four corners stand on the page. */
export function frameCorners(m: MemberFrame): Point[] {
  return CORNER_SIGNS.map(([sx, sy]) =>
    turnedAround(m.center, { x: m.center.x + (sx * m.w) / 2, y: m.center.y + (sy * m.h) / 2 }, m.rotation),
  )
}

const CORNER_SIGNS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const

/**
 * The smallest box around every member's corners, lying at `turn`.
 *
 * A multiple selection has no geometry of its own to remember, only how far it
 * has been turned since it was made — so the box is found by laying the
 * members back by that much, taking the upright box around them, and standing
 * it up again. At a turn of zero it is the plain upright union.
 *
 * Corners rather than frames, because a raster layer mid-gesture may be
 * sheared and has no centre, size and turn to describe it.
 */
export function groupBox(members: readonly (readonly Point[])[], turn: number): GroupBox | null {
  if (members.length === 0) return null
  const origin = { x: 0, y: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const corners of members) {
    for (const corner of corners) {
      const laid = turnedAround(origin, corner, -turn)
      minX = Math.min(minX, laid.x)
      minY = Math.min(minY, laid.y)
      maxX = Math.max(maxX, laid.x)
      maxY = Math.max(maxY, laid.y)
    }
  }
  const middle = turnedAround(origin, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, turn)
  return { centerX: middle.x, centerY: middle.y, width: maxX - minX, height: maxY - minY }
}

/**
 * Where a fractional point of the group's box lands on the page — the pivot a
 * handle pins or the turn goes round.
 */
export function groupPoint(box: GroupBox, turn: number, at: Point): Point {
  const center = { x: box.centerX, y: box.centerY }
  return turnedAround(
    center,
    { x: box.centerX + (at.x - 0.5) * box.width, y: box.centerY + (at.y - 0.5) * box.height },
    turn,
  )
}

/**
 * Where a member's centre goes when the group turns by `turn` and scales by
 * `scale` about `pivot`. Each member also turns by the same amount and scales
 * by the same ratio in place; together the two are exactly the group turning
 * and scaling as one.
 */
export function carried(center: Point, pivot: Point, turn: number, scale: number): Point {
  const reached = {
    x: pivot.x + (center.x - pivot.x) * scale,
    y: pivot.y + (center.y - pivot.y) * scale,
  }
  return turnedAround(pivot, reached, turn)
}

/** Where one member ends up when the group is stretched along its own two axes. */
export interface Stretched {
  center: Point
  /** The member's turn, changed only when it lies across the group's axes. */
  rotation: number
  /** How much longer each of the member's own axes came out. */
  scaleX: number
  scaleY: number
  /**
   * Whether the stretch mirrored the member, which it does when the box was
   * pulled across its pivot along one axis. Read as the member's own
   * horizontal mirrored once more; its turn is the one that goes with that.
   */
  mirrored: boolean
}

/**
 * A member carried by the group stretching `ratio` along the box's axes about
 * `pivot`. The box lies at `turn`; the member at `rotation`.
 *
 * A member lying along the box's axes, or across them at a right angle, comes
 * out exactly. One lying at any other angle would be sheared, which a text
 * object has no field for: it keeps the turn and the length its own axes come
 * out at, and the shear is what is lost.
 */
export function stretched(
  center: Point,
  rotation: number,
  pivot: Point,
  turn: number,
  ratio: Point,
): Stretched {
  const laid = turnedAround(pivot, center, -turn)
  const reached = turnedAround(
    pivot,
    { x: pivot.x + (laid.x - pivot.x) * ratio.x, y: pivot.y + (laid.y - pivot.y) * ratio.y },
    turn,
  )
  const rel = rotation - turn
  let ux = ratio.x * Math.cos(rel)
  let uy = ratio.y * Math.sin(rel)
  const vx = -ratio.x * Math.sin(rel)
  const vy = ratio.y * Math.cos(rel)
  // A mirror is not a turn: with the member's horizontal reversed the two axes
  // stand the right way round again, and only then can the turn be read off.
  const mirrored = ux * vy - uy * vx < 0
  if (mirrored) {
    ux = -ux
    uy = -uy
  }
  return {
    center: reached,
    rotation: rotation + angleDelta(rel, Math.atan2(uy, ux)),
    scaleX: Math.hypot(ux, uy),
    scaleY: Math.hypot(vx, vy),
    mirrored,
  }
}
