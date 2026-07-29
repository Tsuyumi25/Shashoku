import type { LayerEntry, ManifestJson, TextLayerEntry } from './types'


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
 * What is on the page, in the order it is drawn — the canvas and compositing
 * ask the same question and have to get the same answer.
 *
 * Hiding is inherited: a folder that is off takes everything under it with it,
 * whatever those objects say about themselves. That inheritance is also why the
 * label list ignores `visible` entirely — a flat list has nothing to show it
 * with, so the flag it displayed would be lying.
 */
export function visibleTextObjects(manifest: ManifestJson): TextLayerEntry[] {
  const out: TextLayerEntry[] = []
  const walk = (entries: readonly LayerEntry[]): void => {
    for (const e of entries) {
      if (!e.visible) continue
      if (e.kind === 'text') out.push(e)
      else if (e.kind === 'group') walk(e.children)
    }
  }
  walk(manifest.layers)
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
