import type { LayerEntry } from '@shared/page/types'

/**
 * How a node looks, as opposed to whether it is there.
 *
 * The line the panel is drawn along: opacity, blend mode, effects and a text
 * object's style say what a node looks like, while visible, locked and
 * alphaLocked say whether it is there and whether it can be touched. The second
 * group belongs to the layer tree, which is what a tree of nodes is for; this
 * is everything in the first.
 */

/** One node a change may reach, with the page it is on. */
export interface AppearanceTarget<T extends LayerEntry = LayerEntry> {
  pageId: string
  entry: T
}

/**
 * Who a selection is handed to. `mixed` is a selection that disagrees about
 * what its nodes are; `group` is a folder, which agrees and simply has nothing
 * of its own to adjust yet — both draw the shared section alone, for reasons
 * worth being able to tell apart.
 */
export type AppearanceKind = 'none' | LayerEntry['kind'] | 'mixed'
