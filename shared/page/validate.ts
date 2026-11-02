import type { ManifestJson } from './types'
import type { TextSide } from './text'
import { wouldCycle, type ReadingEdge } from './readingGraph'
import { repairPage } from './repair'

/**
 * Each way a page can disagree with itself, named. Named one by one rather than
 * as a single "invalid" so that each has exactly one fix in `repair.ts`, and a
 * test can say which one it means.
 */
export type PageDefectKind =
  /** Two entries answer to the same id, so a reference to it is ambiguous. */
  | 'duplicate-id'
  /** Two units of one ledger answer to the same id, for the same reason. */
  | 'duplicate-unit-id'
  /** A unit names a block the page does not hold. */
  | 'unit-member-dangling'
  /** A unit names another face's lettering. */
  | 'unit-member-foreign'
  /** One block claimed by more than one unit of a ledger, so which one it says is undecided. */
  | 'unit-member-shared'
  /** A unit left with no block on one side, which no sentence can mean. */
  | 'unit-side-empty'
  /** A block no unit of a ledger claims, so nothing says what it is in that face. */
  | 'unit-member-orphan'
  /** The reading order names the same unit more than once. */
  | 'reading-order-duplicate'
  /** The reading order names something no unit answers to. */
  | 'reading-order-dangling'
  /** A unit the reading order never names. */
  | 'reading-order-missing'
  /** A line with an end on something no unit of the ledger answers to. */
  | 'reading-edge-dangling'
  /** A line that closes a ring, which no reading of a page can mean. */
  | 'reading-edge-cycle'

export interface PageDefect {
  kind: PageDefectKind
  id: string
  /** Which face's ledger the fault was found in. Absent for one about the tree. */
  face?: string
  /** The far end, for a fault about a line. Absent for every other kind. */
  to?: string
  /** Which unit the fault was found in, for the ones about membership. */
  unit?: string
  /** Which side of it, for the ones a side can be named for. */
  side?: TextSide
}

/**
 * Which lines a ledger can keep, and what is wrong with the rest — the one
 * place that decides.
 *
 * An end naming nothing is judged first and the ring after, over the lines that
 * survived: a chain held together by a line to a unit that is not there was
 * never a ring in the first place. Which line of a ring loses is decided by the
 * order they arrive in, which the parser has already made canonical — so two
 * copies of one broken file are mended the same way.
 */
export function siftReadingEdges(
  edges: readonly ReadingEdge[],
  unitIds: ReadonlySet<string>,
  face: string,
): { kept: ReadingEdge[]; defects: PageDefect[] } {
  const kept: ReadingEdge[] = []
  const defects: PageDefect[] = []
  for (const edge of edges) {
    if (!unitIds.has(edge.from) || !unitIds.has(edge.to)) {
      defects.push({ kind: 'reading-edge-dangling', id: edge.from, to: edge.to, face })
      continue
    }
    if (wouldCycle(kept, edge)) {
      defects.push({ kind: 'reading-edge-cycle', id: edge.from, to: edge.to, face })
      continue
    }
    kept.push(edge)
  }
  return { kept, defects }
}

/**
 * What is wrong with a page, for the faces the project has.
 *
 * Exactly what repair would mend and nothing else: the fault named here and
 * the fix next door are one pass, so they cannot come to disagree.
 */
export function validatePage(manifest: ManifestJson, faces: readonly string[]): PageDefect[] {
  return repairPage(manifest, faces).repaired
}
