import { cornersOf, obbsIntersect, type Obb } from '@/lib/selection/obb'

/**
 * Which blocks wear the tag stamp: within one sentence, blocks whose frames
 * touch, directly or through one another, are one piece of lettering and
 * share a single stamp, on whichever of them has its top left corner furthest
 * up and left. Frames of other sentences are not looked at. A block in no
 * sentence wears its own.
 */
export function stampedBlocks(
  sentences: readonly (readonly string[])[],
  frames: ReadonlyMap<string, Obb>,
): Set<string> {
  const stamped = new Set(frames.keys())
  for (const members of sentences) {
    const drawn = members.filter((id) => frames.has(id))
    const root = drawn.map((_, i) => i)
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)))
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        if (obbsIntersect(frames.get(drawn[i]!)!, frames.get(drawn[j]!)!)) root[find(i)] = find(j)
      }
    }
    const best = new Map<number, { id: string; reach: number }>()
    drawn.forEach((id, i) => {
      const corner = cornersOf(frames.get(id)!)[0]!
      const reach = corner.x + corner.y
      const group = find(i)
      const held = best.get(group)
      if (held === undefined || reach < held.reach) best.set(group, { id, reach })
      stamped.delete(id)
    })
    for (const { id } of best.values()) stamped.add(id)
  }
  return stamped
}
