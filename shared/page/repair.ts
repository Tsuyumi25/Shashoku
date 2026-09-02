import type { LayerEntry, ManifestJson, TextLayerEntry, TranslationUnit } from './types'
import type { PageDefect } from './validate'
import type { TextSide } from './text'
import { siftReadingEdges } from './validate'
import { blankBlock, generateId } from './schema'
import { allEntries, textObjects } from './tree'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'

const SIDES: readonly TextSide[] = ['source', 'translation']

/**
 * A blank block put where its counterpart stands, so a side that has come back
 * from nothing lands on the balloon it belongs to rather than at the origin.
 */
function counterpartOf(
  id: string,
  side: TextSide,
  beside: TextLayerEntry | undefined,
): TextLayerEntry {
  const style = beside?.body.style ?? DEFAULT_TEXT_STYLE
  const block =
    side === 'source' ? blankBlock(id, 'source', style) : blankBlock(id, 'translation', style)
  if (beside !== undefined) {
    block.body.x = beside.body.x
    block.body.y = beside.body.y
    block.body.rotation = beside.body.rotation
  }
  return block
}

/**
 * One fix per fault named in validate.ts, applied to a copy.
 *
 * Order matters between them: ids are made unique first, because until they
 * are, "which block does this membership mean" has no answer. Membership is
 * settled next, because reading order is over units and a unit is only a unit
 * once both its sides hold something. What a rename leaves behind — a block
 * nothing points at any more — is then picked up by the same pass that catches
 * a block nobody ever pointed at.
 *
 * ⚠️ Nothing here guesses which unit a loose block belongs to. Position,
 * matching words and a shared reading all look like evidence and none of them
 * are: a block standing on its own becomes its own translation, which is wrong
 * in a way somebody can see and undo.
 */
export function repairPage(
  manifest: ManifestJson,
  newId: () => string = generateId,
): { manifest: ManifestJson; repaired: PageDefect[] } {
  const layers: LayerEntry[] = structuredClone(manifest.layers) as LayerEntry[]
  const units: TranslationUnit[] = structuredClone(
    manifest.translationUnits,
  ) as TranslationUnit[]
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
    let replacement = newId()
    while (takenIds.has(replacement)) replacement = newId()
    takenIds.add(replacement)
    entry.id = replacement
  }

  const takenUnitIds = new Set<string>()
  const reportedUnitIds = new Set<string>()
  for (const unit of units) {
    if (!takenUnitIds.has(unit.id)) {
      takenUnitIds.add(unit.id)
      continue
    }
    if (!reportedUnitIds.has(unit.id)) {
      reportedUnitIds.add(unit.id)
      repaired.push({ kind: 'duplicate-unit-id', id: unit.id })
    }
    let replacement = newId()
    while (takenUnitIds.has(replacement)) replacement = newId()
    takenUnitIds.add(replacement)
    unit.id = replacement
  }

  const blocks = new Map(textObjects(layers).map((t) => [t.id, t]))
  const claimed = new Set<string>()
  const added: TextLayerEntry[] = []

  for (const unit of units) {
    for (const side of SIDES) {
      const list = side === 'source' ? unit.source : unit.translation
      const keptMembers: string[] = []
      const keptSeparators: string[] = []
      list.members.forEach((id, at) => {
        const block = blocks.get(id)
        const fault =
          block === undefined
            ? 'unit-member-dangling'
            : block.side !== side
              ? 'unit-member-side-mismatch'
              : claimed.has(id)
                ? 'unit-member-shared'
                : null
        if (fault !== null) {
          repaired.push({ kind: fault, id, unit: unit.id, side })
          return
        }
        claimed.add(id)
        // The gap before this block goes with it, so what is left reads as the
        // blocks that survived with the spacing that was between them.
        if (keptMembers.length > 0) keptSeparators.push(list.separators[at - 1] ?? '')
        keptMembers.push(id)
      })
      list.members = keptMembers
      list.separators = keptSeparators
    }
  }

  for (const unit of units) {
    for (const side of SIDES) {
      const list = side === 'source' ? unit.source : unit.translation
      if (list.members.length > 0) continue
      repaired.push({ kind: 'unit-side-empty', id: unit.id, side })
      const other = side === 'source' ? unit.translation : unit.source
      const beside = blocks.get(other.members[0] ?? '')
      let id = newId()
      while (takenIds.has(id)) id = newId()
      takenIds.add(id)
      const block = counterpartOf(id, side, beside)
      added.push(block)
      blocks.set(id, block)
      claimed.add(id)
      list.members = [id]
      list.separators = []
    }
  }

  for (const [id, block] of blocks) {
    if (claimed.has(id)) continue
    repaired.push({ kind: 'unit-member-orphan', id })
    const other = block.side === 'source' ? 'translation' : 'source'
    let counterpartId = newId()
    while (takenIds.has(counterpartId)) counterpartId = newId()
    takenIds.add(counterpartId)
    const counterpart = counterpartOf(counterpartId, other, block)
    added.push(counterpart)
    claimed.add(id)
    claimed.add(counterpartId)
    let unitId = newId()
    while (takenUnitIds.has(unitId)) unitId = newId()
    takenUnitIds.add(unitId)
    const one = { members: [id], separators: [] }
    const two = { members: [counterpartId], separators: [] }
    units.push({
      id: unitId,
      tags: [],
      source: block.side === 'source' ? one : two,
      translation: block.side === 'source' ? two : one,
      candidates: [],
      chosen: null,
    })
  }

  // A slot pointing at a reading that no longer has a piece for every block is
  // a pointer that has come loose, and the blocks still hold what was typed.
  for (const unit of units) {
    if (unit.chosen === null) continue
    const candidate = unit.candidates.find((c) => c.id === unit.chosen)
    if (candidate === undefined || candidate.pieces.length !== unit.translation.members.length)
      unit.chosen = null
  }

  const unitIds = new Set(units.map((u) => u.id))

  const readingOrder: string[] = []
  const placed = new Set<string>()
  const reportedDuplicates = new Set<string>()
  for (const id of manifest.readingOrder) {
    if (placed.has(id)) {
      if (reportedDuplicates.has(id)) continue
      reportedDuplicates.add(id)
      repaired.push({ kind: 'reading-order-duplicate', id })
      continue
    }
    placed.add(id)
    if (!unitIds.has(id)) {
      repaired.push({ kind: 'reading-order-dangling', id })
      continue
    }
    readingOrder.push(id)
  }

  for (const unit of units) {
    if (readingOrder.includes(unit.id)) continue
    repaired.push({ kind: 'reading-order-missing', id: unit.id })
    readingOrder.push(unit.id)
  }

  const lines = siftReadingEdges(manifest.readingEdges, unitIds)
  repaired.push(...lines.defects)

  return {
    manifest: {
      ...manifest,
      translationUnits: units,
      readingOrder,
      readingEdges: lines.kept,
      layers: [...layers, ...added],
    },
    repaired,
  }
}
