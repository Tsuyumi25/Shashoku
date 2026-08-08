import type { ManifestJson } from './types'
import { allEntries, textObjects } from './tree'
import { wouldCycle, type ReadingEdge } from './readingGraph'

/**
 * Each way a page can disagree with itself, named. Named one by one rather than
 * lumped into "valid or not" because each has its own answer, and the answers
 * live next door in repair.ts — the split is what keeps opening a drifted page
 * from being a choice between refusing it and pretending nothing is wrong.
 */
export type PageDefectKind =
  /** Two entries answer to the same id, so a reference to it is ambiguous. */
  | 'duplicate-id'
  /** The reading order names the same object more than once. */
  | 'reading-order-duplicate'
  /** The reading order names something no text object answers to. */
  | 'reading-order-dangling'
  /** A text object the reading order never names. */
  | 'reading-order-missing'
  /** A line with an end on something no text object on this page answers to. */
  | 'reading-edge-dangling'
  /** A line that closes a ring, which no reading of a page can mean. */
  | 'reading-edge-cycle'

export interface PageDefect {
  kind: PageDefectKind
  id: string
  /** The far end, for a fault about a line. Absent for every other kind. */
  to?: string
}

/**
 * Which lines a page can keep, and what is wrong with the rest — the one place
 * that decides, so the fault named here and the line dropped next door cannot
 * come to disagree.
 *
 * An end naming nothing is judged first and the ring after, over the lines that
 * survived: a chain held together by a line to an object that is not there was
 * never a ring in the first place.
 *
 * Which line of a ring loses is decided by the order they arrive in, which the
 * parser has already made canonical — so two copies of one broken file are
 * mended the same way.
 */
export function siftReadingEdges(
  edges: readonly ReadingEdge[],
  textIds: ReadonlySet<string>,
): { kept: ReadingEdge[]; defects: PageDefect[] } {
  const kept: ReadingEdge[] = []
  const defects: PageDefect[] = []
  for (const edge of edges) {
    if (!textIds.has(edge.from) || !textIds.has(edge.to)) {
      defects.push({ kind: 'reading-edge-dangling', id: edge.from, to: edge.to })
      continue
    }
    if (wouldCycle(kept, edge)) {
      defects.push({ kind: 'reading-edge-cycle', id: edge.from, to: edge.to })
      continue
    }
    kept.push(edge)
  }
  return { kept, defects }
}

/**
 * Coverage is set equality, not containment: an object left out of the order
 * is a fault to fix, never a way of saying it should be skipped. What an export
 * leaves out is the export profile's business.
 */
export function validatePage(manifest: ManifestJson): PageDefect[] {
  const duplicateIds: PageDefect[] = []
  const seenIds = new Set<string>()
  const reportedIds = new Set<string>()
  for (const entry of allEntries(manifest.layers)) {
    if (!seenIds.has(entry.id)) {
      seenIds.add(entry.id)
      continue
    }
    if (reportedIds.has(entry.id)) continue
    reportedIds.add(entry.id)
    duplicateIds.push({ kind: 'duplicate-id', id: entry.id })
  }

  const textIds = textObjects(manifest.layers).map((t) => t.id)
  const textIdSet = new Set(textIds)

  const duplicates: PageDefect[] = []
  const dangling: PageDefect[] = []
  const ordered = new Set<string>()
  const reportedDuplicates = new Set<string>()
  for (const id of manifest.readingOrder) {
    if (ordered.has(id)) {
      if (reportedDuplicates.has(id)) continue
      reportedDuplicates.add(id)
      duplicates.push({ kind: 'reading-order-duplicate', id })
      continue
    }
    ordered.add(id)
    if (!textIdSet.has(id)) dangling.push({ kind: 'reading-order-dangling', id })
  }

  const missing: PageDefect[] = textIds
    .filter((id) => !ordered.has(id))
    .map((id) => ({ kind: 'reading-order-missing', id }))

  const lines = siftReadingEdges(manifest.readingEdges, textIdSet).defects

  return [...duplicateIds, ...duplicates, ...dangling, ...missing, ...lines]
}
