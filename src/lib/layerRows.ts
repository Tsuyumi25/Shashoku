import type { LayerEntry } from '@shared/page/types'

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
