import type { LayerEntry, ManifestJson } from './types'
import type { PageDefect } from './validate'
import { generateId } from './schema'
import { allEntries, textObjects } from './tree'

/**
 * One fix per fault named in validate.ts, applied to a copy.
 *
 * Order matters between them: ids are made unique first, because until they
 * are, "which object does this reading-order entry mean" has no answer. What
 * that rename leaves behind — an object nothing points at any more — is then
 * picked up by the same pass that catches an object nobody ever pointed at.
 */
export function repairPage(
  manifest: ManifestJson,
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
    let replacement = newId()
    while (takenIds.has(replacement)) replacement = newId()
    takenIds.add(replacement)
    entry.id = replacement
  }

  const textIds = textObjects(layers).map((t) => t.id)
  const textIdSet = new Set(textIds)

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
    if (!textIdSet.has(id)) {
      repaired.push({ kind: 'reading-order-dangling', id })
      continue
    }
    readingOrder.push(id)
  }

  for (const id of textIds) {
    if (readingOrder.includes(id)) continue
    repaired.push({ kind: 'reading-order-missing', id })
    readingOrder.push(id)
  }

  return {
    manifest: { ...manifest, readingOrder, layers },
    repaired,
  }
}
