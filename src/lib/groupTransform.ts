import { turnedAround } from '@/lib/coords'
import type { Point } from '@/lib/labelBox'

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

/**
 * The smallest box around every member, lying at `turn`.
 *
 * A multiple selection has no geometry of its own to remember, only how far it
 * has been turned since it was made — so the box is found by laying the
 * members back by that much, taking the upright box around them, and standing
 * it up again. At a turn of zero it is the plain upright union.
 */
export function groupBox(members: readonly MemberFrame[], turn: number): GroupBox | null {
  if (members.length === 0) return null
  const origin = { x: 0, y: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const m of members) {
    for (const [sx, sy] of CORNER_SIGNS) {
      const corner = turnedAround(m.center, { x: m.center.x + (sx * m.w) / 2, y: m.center.y + (sy * m.h) / 2 }, m.rotation)
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

const CORNER_SIGNS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const

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
