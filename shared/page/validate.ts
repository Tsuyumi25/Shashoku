import type { ManifestJson } from './types'
import type { TextSide } from './text'
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
  /** Two units answer to the same id, for the same reason. */
  | 'duplicate-unit-id'
  /** A unit's side names a block the page does not hold. */
  | 'unit-member-dangling'
  /** A source side naming a block of lettering, or the other way round. */
  | 'unit-member-side-mismatch'
  /** One block claimed by more than one place, so which one it says is undecided. */
  | 'unit-member-shared'
  /** A side left with no block at all, which no translation can mean. */
  | 'unit-side-empty'
  /** A block of text no unit claims, so nothing on the page says what it is. */
  | 'unit-member-orphan'
  /** The reading order names the same unit more than once. */
  | 'reading-order-duplicate'
  /** The reading order names something no unit answers to. */
  | 'reading-order-dangling'
  /** A unit the reading order never names. */
  | 'reading-order-missing'
  /** A line with an end on something no unit on this page answers to. */
  | 'reading-edge-dangling'
  /** A line that closes a ring, which no reading of a page can mean. */
  | 'reading-edge-cycle'

export interface PageDefect {
  kind: PageDefectKind
  id: string
  /** The far end, for a fault about a line. Absent for every other kind. */
  to?: string
  /** Which unit the fault was found in, for the ones about membership. */
  unit?: string
  /** Which side of it, for the ones a side can be named for. */
  side?: TextSide
}

/**
 * Which lines a page can keep, and what is wrong with the rest — the one place
 * that decides, so the fault named here and the line dropped next door cannot
 * come to disagree.
 *
 * An end naming nothing is judged first and the ring after, over the lines that
 * survived: a chain held together by a line to a unit that is not there was
 * never a ring in the first place.
 *
 * Which line of a ring loses is decided by the order they arrive in, which the
 * parser has already made canonical — so two copies of one broken file are
 * mended the same way.
 */
export function siftReadingEdges(
  edges: readonly ReadingEdge[],
  unitIds: ReadonlySet<string>,
): { kept: ReadingEdge[]; defects: PageDefect[] } {
  const kept: ReadingEdge[] = []
  const defects: PageDefect[] = []
  for (const edge of edges) {
    if (!unitIds.has(edge.from) || !unitIds.has(edge.to)) {
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

const SIDES: readonly TextSide[] = ['source', 'translation']

/**
 * What every unit's two lists are wrong about, and which blocks no list claims.
 *
 * ⭐ Membership is judged before anything about reading, because reading order
 * is over units and a unit with nothing left in it is not one — the answers
 * next door apply in this order for the same reason.
 */
export function siftMembership(manifest: ManifestJson): PageDefect[] {
  const defects: PageDefect[] = []
  const blocks = new Map(textObjects(manifest.layers).map((t) => [t.id, t]))
  const claimed = new Set<string>()

  for (const unit of manifest.translationUnits) {
    for (const side of SIDES) {
      const members = side === 'source' ? unit.source.members : unit.translation.members
      let kept = 0
      for (const id of members) {
        const block = blocks.get(id)
        if (block === undefined) {
          defects.push({ kind: 'unit-member-dangling', id, unit: unit.id, side })
          continue
        }
        if (block.side !== side) {
          defects.push({ kind: 'unit-member-side-mismatch', id, unit: unit.id, side })
          continue
        }
        if (claimed.has(id)) {
          defects.push({ kind: 'unit-member-shared', id, unit: unit.id, side })
          continue
        }
        claimed.add(id)
        kept += 1
      }
      if (kept === 0) defects.push({ kind: 'unit-side-empty', id: unit.id, side })
    }
  }

  for (const [id] of blocks) {
    if (!claimed.has(id)) defects.push({ kind: 'unit-member-orphan', id })
  }

  return defects
}

/**
 * Coverage is set equality, not containment: a unit left out of the order is a
 * fault to fix, never a way of saying it should be skipped. What an export
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

  const duplicateUnits: PageDefect[] = []
  const seenUnits = new Set<string>()
  const reportedUnits = new Set<string>()
  for (const unit of manifest.translationUnits) {
    if (!seenUnits.has(unit.id)) {
      seenUnits.add(unit.id)
      continue
    }
    if (reportedUnits.has(unit.id)) continue
    reportedUnits.add(unit.id)
    duplicateUnits.push({ kind: 'duplicate-unit-id', id: unit.id })
  }

  const membership = siftMembership(manifest)

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
    if (!seenUnits.has(id)) dangling.push({ kind: 'reading-order-dangling', id })
  }

  const missing: PageDefect[] = [...seenUnits]
    .filter((id) => !ordered.has(id))
    .map((id) => ({ kind: 'reading-order-missing', id }))

  const lines = siftReadingEdges(manifest.readingEdges, seenUnits).defects

  return [
    ...duplicateIds,
    ...duplicateUnits,
    ...membership,
    ...duplicates,
    ...dangling,
    ...missing,
    ...lines,
  ]
}
