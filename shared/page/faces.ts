import type { ManifestJson, TranslationTextLayerEntry } from './types'
import { pathOf, removeAtPath, textObjects } from './tree'
import { emptyLedger, facePage } from './units'

/**
 * A new face lettered the way an existing one is: every sentence and its
 * reading carried over under new ids, every block of lettering copied where it
 * stands and how it looks, with no words and no candidates. The artwork's words
 * are shared, so they are the same blocks.
 */
export function copyFace(manifest: ManifestJson, from: string, to: string, newId: () => string): void {
  const template = facePage(manifest, from)
  const lettering = new Map(
    textObjects(manifest.layers)
      .filter((t): t is TranslationTextLayerEntry => t.side === 'translation' && t.face === from)
      .map((t) => [t.id, t]),
  )
  const blockIds = new Map<string, string>()
  const unitIds = new Map<string, string>()
  const copied = emptyLedger()
  for (const unit of template.units) {
    const members = unit.members.map((id) => {
      const block = lettering.get(id)
      if (!block) return id
      // A JSON round trip rather than structuredClone, which refuses the
      // reactive proxies a live page hands out.
      const copy = JSON.parse(JSON.stringify(block)) as TranslationTextLayerEntry
      copy.id = newId()
      copy.face = to
      copy.body.lines = []
      copy.body.candidates = []
      copy.body.chosen = null
      manifest.layers.push(copy)
      blockIds.set(id, copy.id)
      return copy.id
    })
    const id = newId()
    unitIds.set(unit.id, id)
    copied.units.push({ id, members })
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
