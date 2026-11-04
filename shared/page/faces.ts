import type { LayerEntry, ManifestJson, TranslationTextLayerEntry } from './types'
import { emptyLedger, facePage } from './units'
import { findTextObject } from './tree'
import { faceTree, isPageEntry } from './trees'

/**
 * A new face lettered the way an existing one is: every sentence carried over
 * under a new id, every block of lettering copied where it stands and how it
 * looks, with no words and no candidates. The artwork's words and the page's
 * reading are shared, so the new face reads in the same order from the start.
 *
 * Its tree places the page's materials and its own lettering where the face it
 * copies has them. Drawn layers and folders are that face's own and stay
 * behind: the new face starts from the page, not from another language's art.
 *
 * Numbers are copied too, sentences and blocks alike, so a sentence reads under
 * the same name in both faces until one of them regroups it.
 */
export function copyFace(manifest: ManifestJson, from: string, to: string, newId: () => string): void {
  const template = facePage(manifest, from)
  const copies = new Map<string, TranslationTextLayerEntry>()
  const copied = emptyLedger()
  const counters = manifest.counters
  if (counters.units[from] !== undefined) counters.units[to] = counters.units[from]
  const lettering = (id: string): TranslationTextLayerEntry | undefined => {
    const block = findTextObject(template.layers, id)
    return block?.side === 'translation' ? block : undefined
  }
  for (const unit of template.units) {
    const unitId = newId()
    const members = unit.members.map((member) => {
      const block = lettering(member)
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
      copies.set(member, copy)
      return copy.id
    })
    copied.units.push({ id: unitId, ...(unit.no === undefined ? {} : { no: unit.no }), members })
    if (counters.blocks[unit.id] !== undefined) counters.blocks[unitId] = counters.blocks[unit.id]
  }
  const place = (entries: readonly LayerEntry[]): LayerEntry[] =>
    entries.flatMap((e): LayerEntry[] => {
      if (isPageEntry(manifest, e.id)) return [e]
      if (e.kind === 'group') return place(e.children)
      const copy = copies.get(e.id)
      return copy === undefined ? [] : [copy]
    })
  manifest.faceTrees[to] = place(faceTree(manifest, from))
  manifest.ledgers[to] = copied
}

/** A face off the page: its ledger and its tree, lettering and drawn layers alike. */
export function dropFace(manifest: ManifestJson, face: string): void {
  delete manifest.faceTrees[face]
  delete manifest.ledgers[face]
}
