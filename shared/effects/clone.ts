import type { LayerEffect } from './types'

/**
 * A copy that shares nothing with the list it came from. Needed wherever a list
 * crosses from one node to another: two nodes handed the same array would have
 * the first in-place edit change a node nobody was looking at.
 */
export function cloneEffects(effects: readonly LayerEffect[]): LayerEffect[] {
  return effects.map((effect) => ({ ...effect }))
}
