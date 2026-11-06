import { describe, expect, it } from 'vitest'
import { dubinsPaths, samplePath, shortestDubins, type Pose } from './dubins'

/** Deterministic, so a failure names the same poses every run. */
function poses(count: number): [Pose, Pose][] {
  let seed = 7
  const next = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  return Array.from({ length: count }, () => [
    { x: next() * 400, y: next() * 400, heading: next() * Math.PI * 2 },
    { x: next() * 400, y: next() * 400, heading: next() * Math.PI * 2 },
  ])
}

const sameHeading = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

describe('dubins paths', () => {
  /** Each of the six, wherever it exists, has to land on the goal facing the goal's way. */
  it('ends every candidate on the goal pose', () => {
    for (const [from, to] of poses(200))
      for (const path of dubinsPaths(from, to, 40)) {
        const end = samplePath(path).at(-1)!
        expect(Math.hypot(end.x - to.x, end.y - to.y)).toBeLessThan(1e-6)
        expect(sameHeading(end.heading, to.heading)).toBeLessThan(1e-6)
      }
  })

  it('takes the straight line when both poses already face along it', () => {
    const path = shortestDubins({ x: 0, y: 0, heading: 0 }, { x: 300, y: 0, heading: 0 }, 40)
    expect(path.length).toBeCloseTo(300, 6)
  })

  it('is never shorter than the straight distance', () => {
    for (const [from, to] of poses(200))
      expect(shortestDubins(from, to, 40).length).toBeGreaterThanOrEqual(Math.hypot(to.x - from.x, to.y - from.y) - 1e-6)
  })
})
