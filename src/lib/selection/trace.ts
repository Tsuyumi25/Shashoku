import { ANTS_THRESHOLD } from '@/lib/selection/mask'
import type { Point, Rect } from '@/lib/selection/rect'

/**
 * A selection mask turned into closed outlines, for the marching ants.
 *
 * Every pixel inside the contour is checked against its four neighbours, and
 * each boundary edge becomes a directed unit segment with inside on its right.
 * Walking out-going directions therefore closes a loop on its own, with no
 * winding rule to work out — the loops are only ever stroked, never filled, so
 * an outer boundary and a hole need no telling apart.
 *
 * Scanning top to bottom and left to right is what settles a saddle, where two
 * pixels meet at nothing but a corner: the out-going directions at that vertex
 * are consumed first-in-first-out, which separates the two pixels into their
 * own loops instead of tying them into a bowtie. Diagonal neighbours not
 * counting as connected is the Photoshop and Clip Studio convention.
 *
 * `bounds` is the region to scan and must contain the whole selection —
 * anything outside it reads as unselected, so a selection reaching past it
 * would be given a false edge along the boundary. Inside is the 50% contour,
 * which is where Photoshop puts the ants on a feathered edge.
 */

// 0 = right (+x), 1 = down (+y), 2 = left (-x), 3 = up (-y)
type Direction = 0 | 1 | 2 | 3
const DX = [1, 0, -1, 0] as const
const DY = [0, 1, 0, -1] as const

export function traceMaskOutlines(
  mask: Uint8ClampedArray,
  w: number,
  h: number,
  bounds: Rect,
): Point[][] {
  const outgoing = new Map<number, Direction[]>()
  // A vertex sits on pixel corners, so there are (w+1) of them per row.
  const key = (x: number, y: number): number => y * (w + 1) + x
  const addEdge = (x: number, y: number, d: Direction): void => {
    const k = key(x, y)
    const at = outgoing.get(k)
    if (at) at.push(d)
    else outgoing.set(k, [d])
  }

  const x0 = Math.max(0, bounds.x)
  const y0 = Math.max(0, bounds.y)
  const x1 = Math.min(w, bounds.x + bounds.w)
  const y1 = Math.min(h, bounds.y + bounds.h)
  const inside = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] >= ANTS_THRESHOLD

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      if (!inside(px, py)) continue
      // Each side whose neighbour is out becomes a segment running so that the
      // pixel is on its right: along the top going right, down the right side,
      // along the bottom going left, up the left side.
      if (!inside(px, py - 1)) addEdge(px, py, 0)
      if (!inside(px + 1, py)) addEdge(px + 1, py, 1)
      if (!inside(px, py + 1)) addEdge(px + 1, py + 1, 2)
      if (!inside(px - 1, py)) addEdge(px, py + 1, 3)
    }
  }

  const loops: Point[][] = []
  while (outgoing.size > 0) {
    const startKey = outgoing.keys().next().value as number
    const sx = startKey % (w + 1)
    const sy = (startKey - sx) / (w + 1)

    const loop: Point[] = [{ x: sx, y: sy }]
    let cx = sx
    let cy = sy
    for (;;) {
      const at = outgoing.get(key(cx, cy))
      // Unreachable on a closed loop, where every vertex pairs an in with an
      // out. Kept so a mask that somehow breaks that cannot hang the frame.
      if (!at || at.length === 0) break
      const d = at.shift() as Direction
      if (at.length === 0) outgoing.delete(key(cx, cy))
      cx += DX[d]
      cy += DY[d]
      if (cx === sx && cy === sy) break
      loop.push({ x: cx, y: cy })
    }
    if (loop.length >= 3) loops.push(simplifyCollinear(loop))
  }

  return loops
}

/** Mid-segment vertices say nothing to a stroke, so only corners are kept. */
function simplifyCollinear(loop: Point[]): Point[] {
  const n = loop.length
  if (n < 3) return loop
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n]
    const cur = loop[i]
    const next = loop[(i + 1) % n]
    // Every step is a unit move, so comparing the two direction vectors is
    // enough to know the three points are in line.
    if (cur.x - prev.x === next.x - cur.x && cur.y - prev.y === next.y - cur.y) continue
    out.push(cur)
  }
  return out
}
