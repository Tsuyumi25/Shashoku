import type { LayerEntry } from '@shared/page/types'
import type { DropTarget } from '@shared/page/tree'

export interface LayerTreeRow {
  entry: LayerEntry
  depth: number
  /** Sibling indices from the root — what the store's edits address an entry by. */
  path: number[]
  /**
   * Its own flag says shown, but a folder above it is off. A flat list has no
   * way to say this, which is why the label list ignores visibility altogether
   * and the tree is where it gets shown.
   */
  hiddenByAncestor: boolean
}

/**
 * The page's tree as rows to draw, topmost first.
 *
 * The array runs bottom to top, since the last entry is drawn last and so ends
 * up on top. Every layer panel shows that the other way round, so the rows come
 * back reversed while their paths keep counting from the bottom.
 */
export function flattenLayerRows(
  layers: readonly LayerEntry[],
  collapsed: ReadonlySet<string>,
): LayerTreeRow[] {
  const rows: LayerTreeRow[] = []

  const walk = (
    entries: readonly LayerEntry[],
    prefix: readonly number[],
    depth: number,
    underHidden: boolean,
  ): void => {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const entry = entries[i]
      const path = [...prefix, i]
      rows.push({ entry, depth, path, hiddenByAncestor: underHidden })
      if (entry.kind !== 'group' || collapsed.has(entry.id)) continue
      walk(entry.children, path, depth + 1, underHidden || !entry.visible)
    }
  }

  walk(layers, [], 0, false)
  return rows
}


/** Which part of a row a drag is over. */
export type DropZone = 'above' | 'below' | 'inside'

/**
 * What a drop on a row means, in the terms the tree's own edits take.
 *
 * The panel reads top to bottom while the array counts bottom to top, so this
 * is where the two meet: dropping above a row lands after it in the array, and
 * dropping below it lands before. Getting that backwards puts every drag one
 * place off in a way that is easy to miss and maddening to use.
 */
export function dropTargetFor(row: LayerTreeRow, zone: DropZone): DropTarget | null {
  if (zone === 'inside') {
    if (row.entry.kind !== 'group') return null
    return { parentPath: row.path, index: row.entry.children.length }
  }
  const parentPath = row.path.slice(0, -1)
  const index = row.path[row.path.length - 1]
  return { parentPath, index: zone === 'above' ? index + 1 : index }
}
