import type { ManifestJson, TranslationUnit } from './types'
import { hasEdge, normalizeEdges, wouldCycle, type ReadingEdge } from './readingGraph'
import { textObjects } from './tree'

/**
 * The reading of a page is a fact about its artwork: which balloon is read
 * before which. So it is stored once, between blocks of the artwork's words,
 * and every face sees it through its own sentences. What a face can edit is
 * that same fact — a line drawn or a row dragged in any face lands on the
 * artwork's words, and every other face sees it too.
 */

/** Which sentence of these holds each block of the artwork's words. */
function sentenceOfSource(manifest: ManifestJson, units: readonly TranslationUnit[]): Map<string, string> {
  const sources = new Set(textObjects(manifest.layers).flatMap((b) => (b.side === 'source' ? [b.id] : [])))
  const out = new Map<string, string>()
  for (const u of units) for (const id of u.members) if (sources.has(id) && !out.has(id)) out.set(id, u.id)
  return out
}

function sourcesOf(manifest: ManifestJson, unit: TranslationUnit): string[] {
  const sources = new Set(textObjects(manifest.layers).flatMap((b) => (b.side === 'source' ? [b.id] : [])))
  return unit.members.filter((id) => sources.has(id))
}

/**
 * The page's order of the artwork's words, every one of them: the stored order
 * first, then any it does not name in the order the tree holds them.
 */
export function sourceOrder(manifest: ManifestJson): string[] {
  const sources = textObjects(manifest.layers).flatMap((b) => (b.side === 'source' ? [b.id] : []))
  const present = new Set(sources)
  const listed = manifest.readingOrder.filter((id) => present.has(id))
  const seen = new Set(listed)
  return [...listed, ...sources.filter((id) => !seen.has(id))]
}

/** These sentences in the page's order, each placed where its earliest block of the artwork reads. */
export function projectedOrder(manifest: ManifestJson, units: readonly TranslationUnit[]): string[] {
  const at = new Map(sourceOrder(manifest).map((id, i) => [id, i]))
  const placed = units.map((u, i) => {
    const positions = u.members.flatMap((id) => (at.has(id) ? [at.get(id)!] : []))
    return { id: u.id, at: positions.length > 0 ? Math.min(...positions) : Infinity, i }
  })
  placed.sort((a, b) => a.at - b.at || a.i - b.i)
  return placed.map((p) => p.id)
}

/**
 * The page's lines as these sentences see them. A line between two blocks of
 * one sentence says nothing here. One that would close a ring — this face
 * grouping words the artwork reads apart — is left out; the fact underneath
 * stays as it is.
 */
export function projectedEdges(manifest: ManifestJson, units: readonly TranslationUnit[]): ReadingEdge[] {
  const of = sentenceOfSource(manifest, units)
  const out: ReadingEdge[] = []
  for (const edge of normalizeEdges(manifest.readingEdges)) {
    const from = of.get(edge.from)
    const to = of.get(edge.to)
    if (from === undefined || to === undefined || from === to) continue
    const projected = { from, to }
    if (hasEdge(out, projected) || wouldCycle(out, projected)) continue
    out.push(projected)
  }
  return normalizeEdges(out)
}

/**
 * What a line drawn between two sentences says about the artwork: the last of
 * the first sentence's words is read before the first of the second's. In the
 * face it was drawn in it projects back as the line that was drawn.
 */
export function sourceEdgeFor(
  manifest: ManifestJson,
  units: readonly TranslationUnit[],
  edge: ReadingEdge,
): ReadingEdge | null {
  const from = units.find((u) => u.id === edge.from)
  const to = units.find((u) => u.id === edge.to)
  if (!from || !to) return null
  const a = sourcesOf(manifest, from).at(-1)
  const b = sourcesOf(manifest, to)[0]
  return a !== undefined && b !== undefined && a !== b ? { from: a, to: b } : null
}

/** Every line of the artwork a line between two sentences stands for — what rubbing it out takes away. */
export function sourceEdgesUnder(
  manifest: ManifestJson,
  units: readonly TranslationUnit[],
  edge: ReadingEdge,
): ReadingEdge[] {
  const of = sentenceOfSource(manifest, units)
  return manifest.readingEdges.filter((e) => of.get(e.from) === edge.from && of.get(e.to) === edge.to)
}

/**
 * The artwork's words put in the order these sentences now read, each
 * sentence's words kept together and in the order they already had. Words no
 * sentence here holds go last.
 */
export function sourceOrderFor(manifest: ManifestJson, units: readonly TranslationUnit[], order: readonly string[]): string[] {
  const current = sourceOrder(manifest)
  const at = new Map(current.map((id, i) => [id, i]))
  const byId = new Map(units.map((u) => [u.id, u]))
  const placed = new Set<string>()
  const grouped: string[] = []
  for (const unitId of order) {
    const unit = byId.get(unitId)
    if (!unit) continue
    const words = sourcesOf(manifest, unit)
      .filter((id) => !placed.has(id))
      .sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0))
    for (const id of words) placed.add(id)
    grouped.push(...words)
  }
  const rest = current.filter((id) => !placed.has(id))
  return [...grouped, ...rest]
}

/**
 * Moves the artwork's words among `ids` to read straight after the last of
 * `after`'s, in the order they already had. Ids that are not words of the
 * artwork are passed over.
 */
export function readAfter(manifest: ManifestJson, ids: readonly string[], after: readonly string[]): void {
  const order = sourceOrder(manifest)
  const moving = new Set(ids.filter((id) => order.includes(id)))
  if (moving.size === 0) return
  const rest = order.filter((id) => !moving.has(id))
  const anchors = after.filter((id) => !moving.has(id)).map((id) => rest.indexOf(id)).filter((i) => i >= 0)
  const at = anchors.length > 0 ? Math.max(...anchors) + 1 : rest.length
  rest.splice(at, 0, ...order.filter((id) => moving.has(id)))
  manifest.readingOrder = rest
}
