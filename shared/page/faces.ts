import type { ManifestJson, TranslationTextLayerEntry } from './types'
import { pathOf, removeAtPath, textObjects } from './tree'
import { emptyLedger, facePage } from './units'

/**
 * A new face lettered the way an existing one is: every sentence and its
 * reading carried over under new ids, every block of lettering copied where it
 * stands and how it looks, with no words and no candidates. The artwork's words
 * are shared, so they are the same blocks.
 *
 * Numbers are copied too, sentences and blocks alike, so a sentence reads under
 * the same name in both faces until one of them regroups it.
 */
export function copyFace(manifest: ManifestJson, from: string, to: string, newId: () => string): void {
  const template = facePage(manifest, from)
  const lettering = new Map(
    textObjects(manifest.layers)
      .filter((t): t is TranslationTextLayerEntry => t.side === 'translation' && t.face === from)
      .map((t) => [t.id, t]),
  )
  const unitIds = new Map<string, string>()
  const copied = emptyLedger()
  const counters = manifest.counters
  if (counters.units[from] !== undefined) counters.units[to] = counters.units[from]
  for (const unit of template.units) {
    const unitId = newId()
    const members = unit.members.map((member) => {
      const block = lettering.get(member)
      if (!block) return member
      // A JSON round trip rather than structuredClone, which refuses the
      // reactive proxies a live page hands out.
      const copy = JSON.parse(JSON.stringify(block)) as TranslationTextLayerEntry
      copy.id = newId()
      copy.face = to
      copy.body.lines = []
      copy.body.candidates = []
      copy.body.chosen = null
      if (copy.no !== undefined) copy.numberedIn = unitId
      manifest.layers.push(copy)
      return copy.id
    })
    unitIds.set(unit.id, unitId)
    copied.units.push({ id: unitId, ...(unit.no === undefined ? {} : { no: unit.no }), members })
    if (counters.blocks[unit.id] !== undefined) counters.blocks[unitId] = counters.blocks[unit.id]
  }
  copied.readingOrder = template.readingOrder.flatMap((id) => unitIds.get(id) ?? [])
  copied.readingEdges = template.readingEdges.flatMap((e) => {
    const a = unitIds.get(e.from)
    const b = unitIds.get(e.to)
    return a !== undefined && b !== undefined ? [{ from: a, to: b }] : []
  })
  manifest.ledgers[to] = copied
}

/** A face off the page: its ledger and every block of its lettering. */
export function dropFace(manifest: ManifestJson, face: string): void {
  for (const block of textObjects(manifest.layers)) {
    if (block.side !== 'translation' || block.face !== face) continue
    const path = pathOf(manifest.layers, block.id)
    if (path !== null) removeAtPath(manifest.layers, path)
  }
  delete manifest.ledgers[face]
}
