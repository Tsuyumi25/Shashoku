import type { LayerEntry, Ledger, ManifestJson, TextLayerEntry, TranslationUnit } from './types'
import type { PageDefect } from './validate'
import type { TextSide } from './text'
import { siftReadingEdges } from './validate'
import { blankSourceBlock, blankTranslationBlock, generateId } from './schema'
import { allEntries, textObjects } from './tree'
import { emptyLedger } from './units'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'

/**
 * A blank block put where another block of the same sentence stands, so a side
 * that has come back from nothing lands on the balloon it belongs to rather
 * than at the origin.
 */
function counterpartOf(id: string, side: TextSide, face: string, beside: TextLayerEntry | undefined): TextLayerEntry {
  const style = beside?.body.style ?? DEFAULT_TEXT_STYLE
  const block = side === 'source' ? blankSourceBlock(id, style) : blankTranslationBlock(id, face, style)
  if (beside !== undefined) {
    block.body.x = beside.body.x
    block.body.y = beside.body.y
    block.body.rotation = beside.body.rotation
  }
  return block
}

/**
 * One fix per fault named in validate.ts, applied to a copy, for every face the
 * project has.
 *
 * Order matters between them: ids are made unique first, because until they
 * are, "which block does this membership mean" has no answer. Membership is
 * settled next, every ledger before any is filled in — a blank source block one
 * face needs is a block every other face has to place too. Reading order comes
 * last, because it is over units and a unit is only a unit once both its sides
 * hold something.
 *
 * ⚠️ Nothing here guesses which unit a loose block belongs to. Position,
 * matching words and a shared reading all look like evidence and none of them
 * are: a block standing on its own becomes its own sentence, which is wrong in
 * a way somebody can see and undo.
 */
export function repairPage(
  manifest: ManifestJson,
  faces: readonly string[],
  newId: () => string = generateId,
): { manifest: ManifestJson; repaired: PageDefect[] } {
  const layers: LayerEntry[] = structuredClone(manifest.layers) as LayerEntry[]
  const repaired: PageDefect[] = []

  const takenIds = new Set<string>()
  const reportedIds = new Set<string>()
  for (const entry of allEntries(layers)) {
    if (!takenIds.has(entry.id)) {
      takenIds.add(entry.id)
      continue
    }
    if (!reportedIds.has(entry.id)) {
      reportedIds.add(entry.id)
      repaired.push({ kind: 'duplicate-id', id: entry.id })
    }
    entry.id = freshId(takenIds, newId)
  }

  const blocks = new Map(textObjects(layers).map((t) => [t.id, t]))
  const add = (block: TextLayerEntry) => {
    takenIds.add(block.id)
    blocks.set(block.id, block)
    layers.push(block)
  }

  const ledgers: Record<string, Ledger> = structuredClone(manifest.ledgers)
  const takenUnitIds = new Set<string>()

  // Membership for every face, adding any source block a sentence lacks.
  for (const face of faces) {
    const ledger = (ledgers[face] ??= emptyLedger())
    const seenUnits = new Set<string>()
    const reportedUnits = new Set<string>()
    for (const unit of ledger.units) {
      if (!seenUnits.has(unit.id)) {
        seenUnits.add(unit.id)
        takenUnitIds.add(unit.id)
        continue
      }
      if (!reportedUnits.has(unit.id)) {
        reportedUnits.add(unit.id)
        repaired.push({ kind: 'duplicate-unit-id', id: unit.id, face })
      }
      unit.id = freshId(takenUnitIds, newId)
    }

    const claimed = new Set<string>()
    for (const unit of ledger.units) {
      unit.members = unit.members.filter((id) => {
        const block = blocks.get(id)
        const fault =
          block === undefined
            ? 'unit-member-dangling'
            : block.side === 'translation' && block.face !== face
              ? 'unit-member-foreign'
              : claimed.has(id)
                ? 'unit-member-shared'
                : null
        if (fault !== null) {
          repaired.push({ kind: fault, id, unit: unit.id, face })
          return false
        }
        claimed.add(id)
        return true
      })
      const lettering = unit.members.map((id) => blocks.get(id)!).filter((b) => b.side === 'translation')
      if (unit.members.length > 0 && lettering.length === unit.members.length) {
        repaired.push({ kind: 'unit-side-empty', id: unit.id, side: 'source', face })
        const block = counterpartOf(freshId(takenIds, newId), 'source', face, lettering[0])
        add(block)
        unit.members.unshift(block.id)
        claimed.add(block.id)
      }
    }

    for (const block of [...blocks.values()]) {
      if (block.side !== 'translation' || block.face !== face || claimed.has(block.id)) continue
      repaired.push({ kind: 'unit-member-orphan', id: block.id, face })
      const source = counterpartOf(freshId(takenIds, newId), 'source', face, block)
      add(source)
      ledger.units.push({ id: freshId(takenUnitIds, newId), members: [source.id, block.id] })
      claimed.add(block.id)
      claimed.add(source.id)
    }
  }

  // Every face now sees every source block, including any added above.
  for (const face of faces) {
    const ledger = ledgers[face]!
    const claimed = new Set(ledger.units.flatMap((u) => u.members))
    for (const unit of ledger.units) {
      if (unit.members.length === 0) continue
      const hasLettering = unit.members.some((id) => blocks.get(id)?.side === 'translation')
      if (hasLettering) continue
      repaired.push({ kind: 'unit-side-empty', id: unit.id, side: 'translation', face })
      const block = counterpartOf(freshId(takenIds, newId), 'translation', face, blocks.get(unit.members[0]!))
      add(block)
      unit.members.push(block.id)
    }
    for (const block of [...blocks.values()]) {
      if (block.side !== 'source' || claimed.has(block.id)) continue
      repaired.push({ kind: 'unit-member-orphan', id: block.id, face })
      const lettering = counterpartOf(freshId(takenIds, newId), 'translation', face, block)
      add(lettering)
      ledger.units.push({ id: freshId(takenUnitIds, newId), members: [block.id, lettering.id] })
    }
    ledger.units = ledger.units.filter((u) => u.members.length > 0)
    repairReading(ledger, face, repaired)
  }

  return { manifest: { ...manifest, ledgers, layers }, repaired }
}

function repairReading(ledger: Ledger, face: string, repaired: PageDefect[]): void {
  const unitIds = new Set(ledger.units.map((u: TranslationUnit) => u.id))
  const readingOrder: string[] = []
  const placed = new Set<string>()
  const reportedDuplicates = new Set<string>()
  for (const id of ledger.readingOrder) {
    if (placed.has(id)) {
      if (reportedDuplicates.has(id)) continue
      reportedDuplicates.add(id)
      repaired.push({ kind: 'reading-order-duplicate', id, face })
      continue
    }
    placed.add(id)
    if (!unitIds.has(id)) {
      repaired.push({ kind: 'reading-order-dangling', id, face })
      continue
    }
    readingOrder.push(id)
  }
  for (const unit of ledger.units) {
    if (readingOrder.includes(unit.id)) continue
    repaired.push({ kind: 'reading-order-missing', id: unit.id, face })
    readingOrder.push(unit.id)
  }
  const lines = siftReadingEdges(ledger.readingEdges, unitIds, face)
  repaired.push(...lines.defects)
  ledger.readingOrder = readingOrder
  ledger.readingEdges = lines.kept
}

function freshId(taken: Set<string>, newId: () => string): string {
  let id = newId()
  while (taken.has(id)) id = newId()
  taken.add(id)
  return id
}
