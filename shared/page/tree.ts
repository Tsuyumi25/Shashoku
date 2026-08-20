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
 * Whether an entry refuses to be changed — its own lock, or any folder above it.
 *
 * A locked folder locks what it holds, because what gets dragged and deleted by
 * accident is the children; locking only the shell locks a room with no door.
 *
 * An entry that is not on this page answers false. Nothing is protected by a
 * lock it does not have, and a caller holding an id from somewhere else is
 * asking about something this tree cannot speak for.
 */
export function isLocked(layers: readonly LayerEntry[], id: string): boolean {
  const walk = (entries: readonly LayerEntry[], inherited: boolean): boolean | null => {
    for (const entry of entries) {
      const locked = inherited || entry.locked
      if (entry.id === id) return locked
      if (entry.kind === 'group') {
        const found = walk(entry.children, locked)
        if (found !== null) return found
      }
    }
    return null
  }
  return walk(layers, false) ?? false
}


/**
 * Whether an entry is off, its own switch or a folder's.
 *
 * Inherited the same way locking is, and for the same reason `pageStack` draws
 * it that way: a folder that is off takes everything under it with it, whatever
 * those objects say about themselves.
 *
 * This is the second half of "who may be written to". Refusing a hidden layer is
 * not a rule about hiding — it is that a write you cannot see land is a write
 * you cannot tell went wrong, so the only honest answer is to say so instead.
 *
 * An entry that is not on this page answers false, as `isLocked` does: a tree
 * cannot speak for an id it does not hold.
 */
export function isHidden(layers: readonly LayerEntry[], id: string): boolean {
  const walk = (entries: readonly LayerEntry[], inherited: boolean): boolean | null => {
    for (const entry of entries) {
      const hidden = inherited || !entry.visible
      if (entry.id === id) return hidden
      if (entry.kind === 'group') {
        const found = walk(entry.children, hidden)
        if (found !== null) return found
      }
    }
    return null
  }
  return walk(layers, false) ?? false
}

/**
 * Whether a node can be merged: pixels, or a container of nothing but pixels.
 *
 * Merge exists to turn several appearances into one surface that can still be
 * worked on — a folder gives you a stack, and a brush stroke across it lands on
 * one child. Nobody paints across a translation, and the export bakes the
 * lettering in anyway, so a text object is never what that surface is made of
 * and a folder holding one cannot flatten without taking it.
 *
 * An empty folder qualifies and contributes nothing, which is what the rule
 * says and costs nothing to allow.
 */
export function isMergeable(entry: LayerEntry): boolean {
  if (entry.kind === 'raster') return true
  if (entry.kind === 'group') return entry.children.every(isMergeable)
  return false
}


/**
 * The members of a set that no other member already contains, in tree order.
 *
 * Selecting a folder and something inside it names the same pixels twice, and a
 * merge that took both would draw them twice and then try to remove the inner
 * one from a folder it had already consumed.
 */
export function outermostEntries(
  layers: readonly LayerEntry[],
  ids: ReadonlySet<string>,
): LayerEntry[] {
  const out: LayerEntry[] = []
  const walk = (entries: readonly LayerEntry[]): void => {
    for (const entry of entries) {
      if (ids.has(entry.id)) {
        out.push(entry)
        continue
      }
      if (entry.kind === 'group') walk(entry.children)
    }
  }
  walk(layers)
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

/**
 * The folder a drop is aimed into. Null for the page's own top level, which has
 * no entry to speak for it — and for a path that leads nowhere, since a move
 * along one is refused anyway.
 */
export function folderAtPath(
  layers: readonly LayerEntry[],
  parentPath: readonly number[],
): GroupLayerEntry | null {
  let list = layers
  let folder: GroupLayerEntry | null = null
  for (const index of parentPath) {
    const entry = list[index]
    if (entry === undefined || entry.kind !== 'group') return null
    folder = entry
    list = entry.children
  }
  return folder
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
