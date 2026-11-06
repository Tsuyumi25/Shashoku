import type { Point } from '@/lib/labelBox'

/** A place and the way it faces, in radians from the +x axis. */
export interface Pose {
  x: number
  y: number
  heading: number
}

export type DubinsWord = 'LSL' | 'RSR' | 'LSR' | 'RSL' | 'RLR' | 'LRL'

/**
 * The shortest way from one pose to another that never turns tighter than
 * `radius`: a turn, a straight or a turn, and a turn — each turn at the full
 * radius (Dubins, 1957). `lengths` are the three pieces in units of the radius:
 * radians for a turn, radius-lengths for a straight.
 */
export interface DubinsPath {
  start: Pose
  radius: number
  word: DubinsWord
  lengths: readonly [number, number, number]
  /** In the same units as the poses. */
  length: number
}

const TAU = Math.PI * 2
const mod = (a: number) => ((a % TAU) + TAU) % TAU

/**
 * Each of the six candidates, where it exists. The formulas are the closed
 * forms of Shkel & Lumelsky, "Classification of the Dubins set" (2001), in a
 * frame turned so the goal lies along +x at distance `d` radii.
 */
function candidates(alpha: number, beta: number, d: number): [DubinsWord, number, number, number][] {
  const sa = Math.sin(alpha)
  const sb = Math.sin(beta)
  const ca = Math.cos(alpha)
  const cb = Math.cos(beta)
  const cab = Math.cos(alpha - beta)
  const out: [DubinsWord, number, number, number][] = []

  let pSq = 2 + d * d - 2 * cab + 2 * d * (sa - sb)
  if (pSq >= 0) {
    const turn = Math.atan2(cb - ca, d + sa - sb)
    out.push(['LSL', mod(turn - alpha), Math.sqrt(pSq), mod(beta - turn)])
  }

  pSq = 2 + d * d - 2 * cab + 2 * d * (sb - sa)
  if (pSq >= 0) {
    const turn = Math.atan2(ca - cb, d - sa + sb)
    out.push(['RSR', mod(alpha - turn), Math.sqrt(pSq), mod(turn - beta)])
  }

  pSq = -2 + d * d + 2 * cab + 2 * d * (sa + sb)
  if (pSq >= 0) {
    const p = Math.sqrt(pSq)
    const turn = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p)
    out.push(['LSR', mod(turn - alpha), p, mod(turn - beta)])
  }

  pSq = -2 + d * d + 2 * cab - 2 * d * (sa + sb)
  if (pSq >= 0) {
    const p = Math.sqrt(pSq)
    const turn = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p)
    out.push(['RSL', mod(alpha - turn), p, mod(beta - turn)])
  }

  let c = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8
  if (Math.abs(c) <= 1) {
    const phi = Math.atan2(ca - cb, d - sa + sb)
    const p = mod(TAU - Math.acos(c))
    const t = mod(alpha - phi + p / 2)
    out.push(['RLR', t, p, mod(alpha - beta - t + p)])
  }

  c = (6 - d * d + 2 * cab + 2 * d * (sb - sa)) / 8
  if (Math.abs(c) <= 1) {
    const phi = Math.atan2(ca - cb, d + sa - sb)
    const p = mod(TAU - Math.acos(c))
    const t = mod(-alpha - phi + p / 2)
    out.push(['LRL', t, p, mod(beta - alpha - t + p)])
  }
  return out
}

/** Every path of the six that exists between the two poses. */
export function dubinsPaths(from: Pose, to: Pose, radius: number): DubinsPath[] {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const d = Math.hypot(dx, dy) / radius
  const theta = mod(Math.atan2(dy, dx))
  const alpha = mod(from.heading - theta)
  const beta = mod(to.heading - theta)
  return candidates(alpha, beta, d).map(([word, t, p, q]) => ({
    start: from,
    radius,
    word,
    lengths: [t, p, q] as const,
    length: (t + p + q) * radius,
  }))
}

export function shortestDubins(from: Pose, to: Pose, radius: number): DubinsPath {
  // LSL and RSR have no condition that fails for two distinct poses; the
  // fallback only meets two poses on top of one another.
  return (
    dubinsPaths(from, to, radius).reduce<DubinsPath | null>((best, p) => (best && best.length <= p.length ? best : p), null) ?? {
      start: from,
      radius,
      word: 'LSL',
      lengths: [0, 0, 0],
      length: 0,
    }
  )
}

/** Where a piece of a path ends, `amount` along it in units of the radius. */
function advance(at: Pose, piece: 'L' | 'S' | 'R', amount: number, radius: number): Pose {
  const { heading: h } = at
  if (piece === 'S') return { x: at.x + Math.cos(h) * amount * radius, y: at.y + Math.sin(h) * amount * radius, heading: h }
  const side = piece === 'L' ? 1 : -1
  const next = h + side * amount
  return {
    x: at.x + side * (Math.sin(next) - Math.sin(h)) * radius,
    y: at.y - side * (Math.cos(next) - Math.cos(h)) * radius,
    heading: next,
  }
}

/** Points along the path, turns broken every `step` radians, both ends included. */
export function samplePath(path: DubinsPath, step = Math.PI / 45): Pose[] {
  const out: Pose[] = [path.start]
  let at = path.start
  path.word.split('').forEach((piece, i) => {
    const amount = path.lengths[i]!
    const pieces = piece === 'S' ? 1 : Math.max(1, Math.ceil(amount / step))
    const from = at
    for (let k = 1; k <= pieces; k++) out.push(advance(from, piece as 'L' | 'S' | 'R', (amount * k) / pieces, path.radius))
    at = out[out.length - 1]!
  })
  return out
}

export const toPoint = (p: Pose): Point => ({ x: p.x, y: p.y })
