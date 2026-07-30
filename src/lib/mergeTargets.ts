import type { GroupLayerEntry, LayerEntry, RasterLayerEntry } from '@shared/page/types'
import { folderAtPath, outermostEntries, pathOf } from '@shared/page/tree'

/** Everything a merge is allowed to take. A text object is never one of these. */
export type MergeableEntry = RasterLayerEntry | GroupLayerEntry

/**
 * Whether this node can be taken. Passed in rather than decided here because
 * being mergeable is the tree's question while being unlocked is the editor's,
 * and merge needs both to be true at once.
 */
export type Takeable = (entry: LayerEntry) => entry is MergeableEntry

/**
 * What a selection can actually merge, bottom first — which is the order it is
 * drawn in and merged in.
 *
 * A mixed selection skips what it cannot take, the rule already in force for
 * locked members. Merging a non-contiguous run changes the appearance and every
 * editor accepts that, so the gap a skipped text object leaves is the same class
 * of thing rather than a new exception.
 */
export function mergeParticipants(
  layers: readonly LayerEntry[],
  ids: ReadonlySet<string>,
  takeable: Takeable,
): MergeableEntry[] {
  return outermostEntries(layers, ids).filter(takeable)
}

/**
 * A node and the one directly below it, or nothing.
 *
 * Refuses rather than skips. Merge down names one neighbour instead of taking a
 * set, so stepping past an unmergeable one would drop the result below something
 * that used to be above it — the appearance changes and all the person did was
 * press merge.
 */
export function mergeDownPair(
  layers: readonly LayerEntry[],
  id: string,
  takeable: Takeable,
): MergeableEntry[] {
  const path = pathOf(layers, id)
  if (path === null) return []
  const index = path[path.length - 1]
  if (index === 0) return []
  const parent = folderAtPath(layers, path.slice(0, -1))
  const siblings = parent === null ? layers : parent.children
  const below = siblings[index - 1]
  const here = siblings[index]
  if (below === undefined || here === undefined) return []
  if (!takeable(below) || !takeable(here)) return []
  return [below, here]
}
