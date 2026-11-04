import type { ManifestJson, NumberCounters, TextLayerEntry, TranslationUnit } from './types'
import { everyText } from './trees'
import { facePage, unitsInReadingOrder } from './units'

export function emptyCounters(): NumberCounters {
  return { source: 1, units: {}, blocks: {}, candidates: {} }
}

/**
 * Gives a number to everything on the page that has none, wears one already
 * taken in its container, or wears one issued by a container it has left.
 * Everything already numbered where it stands keeps its number.
 *
 * Idempotent, and the one place numbers are issued: whatever changed the page —
 * an edit, a regroup, a repair, an old file being read — runs this afterwards
 * and the page comes out numbered.
 *
 * A sentence that has to be numbered takes, where it can, the number a sentence
 * in an earlier face holding the same first block of the artwork wears, so a
 * sentence made in every face at once, or a face copied from another, reads
 * under one number in all of them.
 */
export function numberPage(manifest: ManifestJson, faces: readonly string[]): void {
  const counters = (manifest.counters ??= emptyCounters())
  const blocks = everyText(manifest)

  const sides = new Map(blocks.map((b) => [b.id, b.side]))
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const sources = blocks.filter((b) => b.side === 'source')
  counters.source = issue(sources, counters.source)

  const firstSourceNo = new Map<string, number>()
  for (const face of faces) {
    const page = facePage(manifest, face)
    const units = unitsInReadingOrder(page)
    for (const u of page.units) if (!units.includes(u)) units.push(u)
    let next = Math.max(counters.units[face] ?? 1, maxNo(units) + 1)
    const taken = new Set<number>()
    const needing: TranslationUnit[] = []
    for (const u of units) {
      if (u.no !== undefined && !taken.has(u.no)) taken.add(u.no)
      else needing.push(u)
    }
    for (const u of needing) {
      const shared = firstSourceNo.get(firstSource(u, sides) ?? '')
      if (shared !== undefined && shared >= next && !taken.has(shared)) {
        u.no = shared
        next = shared + 1
      } else {
        u.no = next++
      }
      taken.add(u.no)
    }
    counters.units[face] = next
    for (const u of units) {
      const source = firstSource(u, sides)
      if (source !== undefined && !firstSourceNo.has(source)) firstSourceNo.set(source, u.no!)
    }

    for (const u of units) {
      const lettering = u.members.flatMap((id) => {
        const b = byId.get(id)
        return b?.side === 'translation' && b.face === face ? [b] : []
      })
      for (const b of lettering) if (b.side === 'translation' && b.numberedIn !== u.id) delete b.no
      counters.blocks[u.id] = issue(lettering, counters.blocks[u.id] ?? 1)
      for (const b of lettering) if (b.side === 'translation') b.numberedIn = u.id
    }
  }

  for (const b of blocks) {
    if (b.side !== 'translation') continue
    counters.candidates[b.id] = issue(b.body.candidates, counters.candidates[b.id] ?? 1)
  }
}

/** Numbers what has none or repeats one, in order, and answers the container's next number. */
function issue<T extends { no?: number }>(items: readonly T[], next: number): number {
  let counter = Math.max(next, maxNo(items) + 1)
  const taken = new Set<number>()
  for (const item of items) {
    if (item.no !== undefined && !taken.has(item.no)) taken.add(item.no)
    else item.no = counter++
  }
  return counter
}

function maxNo(items: readonly { no?: number }[]): number {
  return items.reduce((m, i) => (i.no !== undefined && i.no > m ? i.no : m), 0)
}

function firstSource(unit: TranslationUnit, sides: ReadonlyMap<string, TextLayerEntry['side']>): string | undefined {
  return unit.members.find((id) => sides.get(id) === 'source')
}

/** A candidate's letter: 1 is `a`, 26 is `z`, 27 is `aa`. */
export function letterOf(no: number): string {
  let out = ''
  for (let n = no; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(97 + ((n - 1) % 26)) + out
  return out
}

/** The number a letter stands for, or null for anything that is not one. */
export function noOfLetter(letter: string): number | null {
  if (!/^[a-z]+$/.test(letter)) return null
  let n = 0
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 96)
  return n
}
