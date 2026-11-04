/**
 * The page's tree and each face's, and the one rule between them.
 *
 * Every face is its own document. The page supplies materials — the base map
 * and the retouch layer it was made with, layers a face promoted, and the
 * artwork's words — and owns them: a face only decides where they stand in its
 * own stack and which of its folders hold them. Deleting one, hiding it,
 * painting on it are the page's, and since a page entry is the very object every
 * face tree holds, a write to it reaches every face without being copied.
 *
 * Kept true here and by repair:
 * - every entry of `pageTree` stands exactly once in every face tree;
 * - a face tree holds nothing of another face's;
 * - `pageTree` holds no folder, since a folder is always a face's.
 */
import type { LayerEntry, ManifestJson, TextLayerEntry } from './types'
import type { TextSide } from './text'
import { allEntries, insertAtPath, pathOf, removeAtPath } from './tree'

/**
 * A face's tree. Repair gives every face of the project one, so a face without
 * one is a face the project does not have; it reads as the page's materials
 * alone, in an array of its own, so writing to it cannot reach the page.
 */
export function faceTree(m: ManifestJson, face: string): readonly LayerEntry[] {
  return m.faceTrees[face] ?? [...m.pageTree]
}

/** A face's tree to write into, made from the page's materials if the face has none yet. */
export function ownTree(m: ManifestJson, face: string): LayerEntry[] {
  return (m.faceTrees[face] ??= [...m.pageTree])
}

/** The tree a side is worked in: the page's own for the artwork's words, a face's for its lettering. */
export function treeOf(m: ManifestJson, side: TextSide, face: string): readonly LayerEntry[] {
  return side === 'source' ? m.pageTree : faceTree(m, face)
}

/** Every entry on the page once, whichever trees hold it: the page's first, then each face's own. */
export function everyEntry(m: ManifestJson): LayerEntry[] {
  const seen = new Set<LayerEntry>()
  const out: LayerEntry[] = []
  for (const tree of [m.pageTree, ...Object.values(m.faceTrees)]) {
    for (const entry of allEntries(tree)) {
      if (seen.has(entry)) continue
      seen.add(entry)
      out.push(entry)
    }
  }
  return out
}

export function entryOnPage(m: ManifestJson, id: string): LayerEntry | undefined {
  return everyEntry(m).find((e) => e.id === id)
}

export function textOnPage(m: ManifestJson, id: string): TextLayerEntry | undefined {
  const entry = entryOnPage(m, id)
  return entry?.kind === 'text' ? entry : undefined
}

/** Every text object on the page once, the artwork's words and every face's lettering. */
export function everyText(m: ManifestJson): TextLayerEntry[] {
  return everyEntry(m).filter((e): e is TextLayerEntry => e.kind === 'text')
}

export function isPageEntry(m: ManifestJson, id: string): boolean {
  return m.pageTree.some((e) => e.id === id)
}

/** Whose an entry is: the page's (`null`), the face whose tree holds it as its own, or nobody's (`undefined`). */
export function homeOf(m: ManifestJson, id: string): string | null | undefined {
  if (isPageEntry(m, id)) return null
  for (const [face, tree] of Object.entries(m.faceTrees)) {
    if (pathOf(tree, id) !== null) return face
  }
  return undefined
}

/**
 * Something the page owns, joining it: at `path` in its own tree, or on top,
 * and on top of every face's — the face has not placed it yet, and on top is
 * where anything new lands.
 */
export function addPageEntry(m: ManifestJson, entry: LayerEntry, path?: readonly number[]): void {
  if (path === undefined || !insertAtPath(m.pageTree, path, entry)) m.pageTree.push(entry)
  for (const tree of Object.values(m.faceTrees)) tree.push(entry)
}

/** Something a face owns, joining its tree at `path` or on top. */
export function addFaceEntry(m: ManifestJson, face: string, entry: LayerEntry, path?: readonly number[]): void {
  const tree = ownTree(m, face)
  if (path === undefined || !insertAtPath(tree, path, entry)) tree.push(entry)
}

/**
 * An entry off the page wherever it stands: a page entry from the page and
 * every face, a face's from its face.
 *
 * ⭐ A face's folder goes with what is the face's in it, and leaves the page's
 * materials it held standing where it stood, in the order they stood. Taking a
 * page material away is the page's to do, which a face does by removing that
 * material itself — never as a side effect of tidying its own folders.
 */
export function removeFromPage(m: ManifestJson, id: string): LayerEntry | null {
  const entry = entryOnPage(m, id)
  if (entry === undefined) return null
  if (isPageEntry(m, id)) {
    for (const tree of [m.pageTree, ...Object.values(m.faceTrees)]) {
      const at = pathOf(tree, id)
      if (at !== null) removeAtPath(tree, at)
    }
    return entry
  }
  for (const tree of Object.values(m.faceTrees)) {
    const at = pathOf(tree, id)
    if (at === null) continue
    removeAtPath(tree, at)
    const kept = allEntries([entry]).filter((e) => isPageEntry(m, e.id))
    kept.forEach((e, i) => insertAtPath(tree, [...at.slice(0, -1), at[at.length - 1]! + i], e))
  }
  return entry
}

/**
 * The trees as plain data, a face's page entries written as references — the
 * shape undo holds and the manifest stores. A copy of the objects themselves
 * would hold each page entry once per tree, and writing one back would give
 * every face a page entry of its own.
 */
export interface TreesSnapshot {
  pageTree: LayerEntry[]
  faceTrees: Record<string, PlacedEntry[]>
}

/** A page entry standing in a face tree, by id. */
export interface PageRef {
  kind: 'ref'
  id: string
}

export type PlacedEntry = LayerEntry | PageRef | PlacedGroup

interface PlacedGroup extends Omit<Extract<LayerEntry, { kind: 'group' }>, 'children'> {
  children: PlacedEntry[]
}

export function placedTree(m: ManifestJson, tree: readonly LayerEntry[]): PlacedEntry[] {
  const pageIds = new Set(m.pageTree.map((e) => e.id))
  const place = (entries: readonly LayerEntry[]): PlacedEntry[] =>
    entries.map((e) => {
      if (pageIds.has(e.id)) return { kind: 'ref', id: e.id }
      if (e.kind === 'group') return { ...e, children: place(e.children) }
      return e
    })
  return place(tree)
}

export function snapshotTrees(m: ManifestJson): TreesSnapshot {
  // A JSON round trip rather than structuredClone: arrays written back through
  // the reactive page hold proxies as elements, which it refuses.
  return JSON.parse(
    JSON.stringify({
      pageTree: m.pageTree,
      faceTrees: Object.fromEntries(Object.entries(m.faceTrees).map(([f, t]) => [f, placedTree(m, t)])),
    }),
  ) as TreesSnapshot
}

/**
 * Face trees whose references are made the page's own entries again. A
 * reference to an entry the page does not have is dropped: it names something
 * gone, and repair would drop it anyway.
 */
export function resolveTrees(
  pageTree: LayerEntry[],
  placed: Record<string, readonly PlacedEntry[]>,
): Record<string, LayerEntry[]> {
  const byId = new Map(pageTree.map((e) => [e.id, e]))
  const resolve = (entries: readonly PlacedEntry[]): LayerEntry[] =>
    entries.flatMap((e): LayerEntry[] => {
      if (e.kind === 'ref') {
        const found = byId.get(e.id)
        return found === undefined ? [] : [found]
      }
      if (e.kind === 'group') return [{ ...e, children: resolve(e.children) } as LayerEntry]
      return [e as LayerEntry]
    })
  return Object.fromEntries(Object.entries(placed).map(([f, t]) => [f, resolve(t)]))
}

/**
 * Puts the rule back where a page has drifted from it, the way repair does:
 * every face tree loses what is neither the page's nor its own and anything it
 * holds twice, and gains on top every page entry it is missing. Every face named
 * gets a tree. Answers whether anything moved.
 */
export function settleTrees(m: ManifestJson, faces: readonly string[]): boolean {
  let moved = false
  // A folder in the page's tree is a face's that got there; its contents stay as the page's.
  if (m.pageTree.some((e) => e.kind === 'group')) {
    m.pageTree = m.pageTree.flatMap((e) => (e.kind === 'group' ? allEntries(e.children).filter((c) => c.kind !== 'group') : [e]))
    moved = true
  }
  const pageIds = new Set(m.pageTree.map((e) => e.id))
  for (const face of faces) {
    if (m.faceTrees[face] === undefined) {
      m.faceTrees[face] = [...m.pageTree]
      moved = true
    }
  }
  // An entry of a face's own is that face's alone: one found in a second tree is dropped there.
  const claimed = new Set<string>()
  for (const [face, tree] of Object.entries(m.faceTrees)) {
    const seen = new Set<string>()
    const keep = (entries: LayerEntry[]): LayerEntry[] =>
      entries.flatMap((e): LayerEntry[] => {
        const isPage = pageIds.has(e.id)
        const foreign = e.kind === 'text' && e.side === 'translation' && e.face !== face
        const stray = e.kind === 'text' && e.side === 'source' && !isPage
        if (seen.has(e.id) || foreign || stray || (!isPage && claimed.has(e.id))) {
          moved = true
          return []
        }
        seen.add(e.id)
        if (e.kind === 'group') {
          const children = keep(e.children)
          if (children.length !== e.children.length) e.children = children
        }
        return [e]
      })
    const kept = keep(tree)
    for (const id of seen) if (!pageIds.has(id)) claimed.add(id)
    const missing = m.pageTree.filter((e) => !seen.has(e.id))
    if (kept.length !== tree.length || missing.length > 0) {
      m.faceTrees[face] = [...kept, ...missing]
      moved = true
    }
  }
  // A page entry a face tree holds must be the page's own object, so a write reaches every face.
  const own = new Map(m.pageTree.map((e) => [e.id, e]))
  for (const tree of Object.values(m.faceTrees)) {
    const swap = (entries: LayerEntry[]): void => {
      for (const [i, e] of entries.entries()) {
        const page = own.get(e.id)
        if (page !== undefined && page !== e) {
          entries[i] = page
          moved = true
        } else if (e.kind === 'group') swap(e.children)
      }
    }
    swap(tree)
  }
  return moved
}

/**
 * A page to work a change out on before it is applied: everything copied, and
 * each face tree's page entries the copy's own page entries again.
 */
export function draftOf(m: ManifestJson): ManifestJson {
  const { pageTree: _page, faceTrees: _faces, ...rest } = m
  const trees = snapshotTrees(m)
  return {
    ...(JSON.parse(JSON.stringify(rest)) as Omit<ManifestJson, 'pageTree' | 'faceTrees'>),
    pageTree: trees.pageTree,
    faceTrees: resolveTrees(trees.pageTree, trees.faceTrees),
  }
}

/**
 * A face's raster made the page's: it stays where it stands in that face, and
 * every other face gains it on top, since none of them has placed it yet.
 */
export function linkToPage(m: ManifestJson, face: string, id: string): boolean {
  const entry = entryOnPage(m, id)
  if (entry?.kind !== 'raster' || homeOf(m, id) !== face) return false
  m.pageTree.push(entry)
  for (const [other, tree] of Object.entries(m.faceTrees)) if (other !== face) tree.push(entry)
  return true
}

/**
 * A page raster taken into one face: it stays where it stands there, and leaves
 * the page and every other face. It is moved, never copied — a copy left in each
 * face would multiply with every unlink.
 */
export function unlinkToFace(m: ManifestJson, face: string, id: string): boolean {
  const entry = entryOnPage(m, id)
  const tree = m.faceTrees[face]
  if (entry?.kind !== 'raster' || !isPageEntry(m, id) || tree === undefined || pathOf(tree, id) === null) return false
  for (const t of [m.pageTree, ...Object.entries(m.faceTrees).filter(([f]) => f !== face).map(([, t]) => t)]) {
    const at = pathOf(t, id)
    if (at !== null) removeAtPath(t, at)
  }
  return true
}
