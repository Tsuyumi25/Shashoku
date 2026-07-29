import type { ManifestJson } from './types'
import { allEntries, textObjects } from './tree'

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

export interface PageDefect {
  kind: PageDefectKind
  id: string
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

  return [...duplicateIds, ...duplicates, ...dangling, ...missing]
}
