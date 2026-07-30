import type { GroupLayerEntry, LayerEntry, ManifestJson, TextLayerEntry } from './types'


/** Every entry on the page, containers included, in tree order. */
export function allEntries(layers: readonly LayerEntry[]): LayerEntry[] {
  const out: LayerEntry[] = []
  const walk = (entries: readonly LayerEntry[]): void => {
    for (const e of entries) {
      out.push(e)
      if (e.kind === 'group') walk(e.children)
    }
  }
  walk(layers)
  return out
}


/** The text objects alone, in tree order — which is stacking order. */
export function textObjects(layers: readonly LayerEntry[]): TextLayerEntry[] {
  const out: TextLayerEntry[] = []
  const walk = (entries: readonly LayerEntry[]): void => {
    for (const e of entries) {
      if (e.kind === 'text') out.push(e)
      else if (e.kind === 'group') walk(e.children)
    }
  }
  walk(layers)
  return out
}


/** Anything on the page by id — a folder and a raster included. */
export function findEntry(
  layers: readonly LayerEntry[],
  id: string,
): LayerEntry | undefined {
  return allEntries(layers).find((e) => e.id === id)
}


export function findTextObject(
  layers: readonly LayerEntry[],
  id: string,
): TextLayerEntry | undefined {
  return textObjects(layers).find((t) => t.id === id)
}


/**
 * The page as a reader meets it — the label list's projection.
 *
 * Built from `readingOrder` alone. An object the order does not name is absent
 * from the answer rather than recovered from where it sits in the tree: a
 * fallback is how an order someone set reverts to stacking order without ever
 * saying so. Keeping the two in step is the repair layer's job, done once on
 * the way in.
 */
export function textObjectsInReadingOrder(manifest: ManifestJson): TextLayerEntry[] {
  const byId = new Map(textObjects(manifest.layers).map((t) => [t.id, t]))
  const out: TextLayerEntry[] = []
  const seen = new Set<string>()
  for (const id of manifest.readingOrder) {
    if (seen.has(id)) continue
    const entry = byId.get(id)
    if (entry === undefined) continue
    seen.add(id)
    out.push(entry)
  }
  return out
}


/**
 * Where an entry sits: sibling indices from the root down. Enough to put a
 * deleted entry back exactly where it was, which is what undo needs and what a
 * bare index into a flattened list cannot say.
 */
export function pathOf(layers: readonly LayerEntry[], id: string): number[] | null {
  const walk = (entries: readonly LayerEntry[], prefix: readonly number[]): number[] | null => {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i]
      if (entry.id === id) return [...prefix, i]
      if (entry.kind === 'group') {
        const found = walk(entry.children, [...prefix, i])
        if (found !== null) return found
      }
    }
    return null
  }
  return walk(layers, [])
}

function siblingsAt(layers: LayerEntry[], path: readonly number[]): LayerEntry[] | null {
  let list = layers
  for (let depth = 0; depth < path.length - 1; depth += 1) {
    const entry = list[path[depth]]
    if (entry === undefined || entry.kind !== 'group') return null
    list = entry.children
  }
  return list
}

export function removeAtPath(layers: LayerEntry[], path: readonly number[]): LayerEntry | null {
  if (path.length === 0) return null
  const siblings = siblingsAt(layers, path)
  const index = path[path.length - 1]
  if (siblings === null || index < 0 || index >= siblings.length) return null
  return siblings.splice(index, 1)[0] ?? null
}

export function insertAtPath(
  layers: LayerEntry[],
  path: readonly number[],
  entry: LayerEntry,
): boolean {
  if (path.length === 0) return false
  const siblings = siblingsAt(layers, path)
  const index = path[path.length - 1]
  if (siblings === null || index < 0 || index > siblings.length) return false
  siblings.splice(index, 0, entry)
  return true
}


/** Where a move is aimed: which folder, and where among what it already holds. */
export interface DropTarget {
  /** The folder to drop into. Empty means the page's own top level. */
  parentPath: number[]
  /** Counted before the move is applied, as the tree reads on screen. */
  index: number
}

function childrenAt(layers: LayerEntry[], parentPath: readonly number[]): LayerEntry[] | null {
  let list = layers
  for (const index of parentPath) {
    const entry = list[index]
    if (entry === undefined || entry.kind !== 'group') return null
    list = entry.children
  }
  return list
}

function startsWith(path: readonly number[], prefix: readonly number[]): boolean {
  return prefix.length <= path.length && prefix.every((n, i) => path[i] === n)
}

/**
 * Restack one entry, which is the only thing the tree's own order means.
 *
 * Nothing here touches the entries themselves, so a page's reading order comes
 * through a restack unchanged — that separation is the reason the two orders
 * are kept apart in the first place.
 *
 * Two things have to be got right and neither is visible from the call site.
 * A folder cannot be dropped into itself or into anything it already holds,
 * which would cut that branch off the tree entirely. And taking the entry out
 * first shifts its later siblings down one, so a destination the user aimed at
 * before the move has to be corrected afterwards or it lands one place off.
 */
export function moveEntry(
  layers: LayerEntry[],
  fromPath: readonly number[],
  target: DropTarget,
): boolean {
  if (fromPath.length === 0) return false
  if (startsWith(target.parentPath, fromPath)) return false

  const source = siblingsAt(layers, fromPath)
  const fromIndex = fromPath[fromPath.length - 1]
  if (source === null || fromIndex < 0 || fromIndex >= source.length) return false
  if (childrenAt(layers, target.parentPath) === null) return false

  const entry = source.splice(fromIndex, 1)[0]

  const parentPath = [...target.parentPath]
  let index = target.index
  const fromParent = fromPath.slice(0, -1)
  if (startsWith(parentPath, fromParent)) {
    if (parentPath.length > fromParent.length) {
      if (parentPath[fromParent.length] > fromIndex) parentPath[fromParent.length] -= 1
    } else if (index > fromIndex) {
      index -= 1
    }
  }

  const destination = childrenAt(layers, parentPath)
  if (destination === null) {
    source.splice(fromIndex, 0, entry)
    return false
  }
  destination.splice(Math.min(Math.max(index, 0), destination.length), 0, entry)
  return true
}


/**
 * Take a folder away and leave what it held in its place, which is the only
 * safe way to be rid of one: a folder carries no style and no meaning, so
 * nothing is lost by removing it, while deleting it outright would take
 * translations with it.
 */
export function dissolveGroupAt(
  layers: LayerEntry[],
  path: readonly number[],
): GroupLayerEntry | null {
  if (path.length === 0) return null
  const siblings = siblingsAt(layers, path)
  const index = path[path.length - 1]
  if (siblings === null || index < 0 || index >= siblings.length) return null
  const entry = siblings[index]
  if (entry.kind !== 'group') return null
  siblings.splice(index, 1, ...entry.children)
  return entry
}

/** Undoes a dissolve: gathers the folder's contents back up where they lie. */
export function restoreGroupAt(
  layers: LayerEntry[],
  path: readonly number[],
  folder: GroupLayerEntry,
): boolean {
  if (path.length === 0) return false
  const siblings = siblingsAt(layers, path)
  const index = path[path.length - 1]
  if (siblings === null || index < 0 || index + folder.children.length > siblings.length)
    return false
  siblings.splice(index, folder.children.length, folder)
  return true
}
