import type {
  LayerEntry,
  Ledger,
  ManifestJson,
  SourceTextLayerEntry,
  TextLayerEntry,
  TranslationCandidate,
  TranslationTextLayerEntry,
  TranslationUnit,
} from './types'
import { flattenReading, type ReadingEdge, type ReadingRow } from './readingGraph'
import type { TextSide } from './text'
import { linesOf } from './text'
import { plainOf } from './markup'
import { normalizeTagSet } from '../tags/set'
import { textObjects } from './tree'
import { projectedEdges, projectedOrder } from './reading'

/**
 * What stands between the blocks of one sentence when it is read as one
 * stretch. A slash rather than nothing: the blocks were set apart on purpose,
 * and reading them as one run of text would claim a sentence the page does not
 * hold. Language-neutral, which a space or no space is not.
 */
export const BLOCK_JOINER = '/'

export function emptyLedger(): Ledger {
  return { units: [] }
}

/**
 * A page as one translation face reads it: the shared tree, that face's
 * sentences, and the page's reading seen through them.
 *
 * `units` reads and writes straight through to the face's ledger. The reading
 * fields are read-only projections: the reading belongs to the artwork, and is
 * changed through `reading.ts` on `manifest`.
 */
export interface FacePage {
  readonly face: string
  readonly manifest: ManifestJson
  layers: LayerEntry[]
  units: TranslationUnit[]
  readonly readingOrder: string[]
  readonly readingEdges: ReadingEdge[]
}

export function facePage(manifest: ManifestJson, face: string): FacePage {
  const ledger = (): Ledger => (manifest.ledgers[face] ??= emptyLedger())
  return {
    face,
    manifest,
    get layers() {
      return manifest.layers
    },
    set layers(v) {
      manifest.layers = v
    },
    get units() {
      return ledger().units
    },
    set units(v) {
      ledger().units = v
    },
    get readingOrder() {
      return projectedOrder(manifest, ledger().units)
    },
    get readingEdges() {
      return projectedEdges(manifest, ledger().units)
    },
  }
}

/** Whether a block is on the side being shown, a translation block counting only for its own face. */
export function isOnView(block: TextLayerEntry, side: TextSide, face: string): boolean {
  return block.side === side && (block.side === 'source' || block.face === face)
}

/** The blocks of one side of a sentence, in the order it is read, skipping any the page has lost. */
export function blocksOf(page: FacePage, unit: TranslationUnit, side: TextSide): TextLayerEntry[] {
  const byId = new Map(textObjects(page.layers).map((t) => [t.id, t]))
  const out: TextLayerEntry[] = []
  for (const id of unit.members) {
    const entry = byId.get(id)
    if (entry !== undefined && isOnView(entry, side, page.face)) out.push(entry)
  }
  return out
}

export function sourceBlocksOf(page: FacePage, unit: TranslationUnit): SourceTextLayerEntry[] {
  return blocksOf(page, unit, 'source') as SourceTextLayerEntry[]
}

export function translationBlocksOf(page: FacePage, unit: TranslationUnit): TranslationTextLayerEntry[] {
  return blocksOf(page, unit, 'translation') as TranslationTextLayerEntry[]
}

/** Only the blocks of one side, a translation side meaning one face's, in tree order — which is stacking order. */
export function blocksOnSide(layers: readonly LayerEntry[], side: TextSide, face: string): TextLayerEntry[] {
  return textObjects(layers).filter((t) => isOnView(t, side, face))
}

export interface UnitPlace {
  unit: TranslationUnit
  side: TextSide
}

/**
 * Which sentence of this face a block belongs to.
 *
 * A source block belongs to exactly one unit of every ledger and a translation
 * block to exactly one of its own face's, so the answer is unambiguous when the
 * page holds together, and absent when it does not — or when the block is
 * another face's.
 */
export function placeOfBlock(page: FacePage, blockId: string): UnitPlace | undefined {
  const block = textObjects(page.layers).find((t) => t.id === blockId)
  if (block === undefined || (block.side === 'translation' && block.face !== page.face)) return undefined
  const unit = page.units.find((u) => u.members.includes(blockId))
  return unit === undefined ? undefined : { unit, side: block.side }
}

export function unitOfBlock(page: FacePage, blockId: string): TranslationUnit | undefined {
  return placeOfBlock(page, blockId)?.unit
}

export function findUnit(page: FacePage, id: string): TranslationUnit | undefined {
  return page.units.find((u) => u.id === id)
}

/**
 * The page as a reader of this face meets it.
 *
 * Built from `readingOrder` alone. A unit the order does not name is absent
 * rather than recovered from where its blocks sit in the tree: a fallback is how
 * an order someone set reverts to stacking order without ever saying so.
 */
export function unitsInReadingOrder(page: FacePage): TranslationUnit[] {
  const byId = new Map(page.units.map((u) => [u.id, u]))
  const out: TranslationUnit[] = []
  const seen = new Set<string>()
  for (const id of page.readingOrder) {
    if (seen.has(id)) continue
    const unit = byId.get(id)
    if (unit === undefined) continue
    seen.add(id)
    out.push(unit)
  }
  return out
}

/**
 * The page as its lines read it: what a line touches first, in an order every
 * line points down, then the rest as `readingOrder` has them. The order list
 * alone is how the page was typed, not the story — on a page whose lines run
 * 9 → 5 → 3 it still says 1, 2, 3.
 */
export function unitsAlongLines(page: FacePage): (ReadingRow & { unit: TranslationUnit })[] {
  const byId = new Map(unitsInReadingOrder(page).map((u) => [u.id, u]))
  return flattenReading(page.readingEdges, page.readingOrder).flatMap((row) => {
    const unit = byId.get(row.id)
    return unit === undefined ? [] : [{ ...row, unit }]
  })
}

/** The candidate a block reads as, or null for its own lines — a slot naming one that is gone reads as its own. */
export function chosenCandidateOf(block: TranslationTextLayerEntry): TranslationCandidate | null {
  const { chosen, candidates } = block.body
  if (chosen === null) return null
  return candidates.find((c) => c.id === chosen) ?? null
}

/**
 * The markup one block holds on the page, chosen candidate resolved.
 *
 * ⭐ Every surface that draws lettering goes through here — the canvas, the
 * export compositor, the thumbnail's identity — so a chosen candidate cannot be
 * showing on one of them and not another.
 */
export function shownCodeOf(block: TextLayerEntry): string {
  if (block.side === 'source') return block.body.lines.join('\n')
  return (chosenCandidateOf(block)?.lines ?? block.body.lines).join('\n')
}

/**
 * What one block reads as — the words without the markup around them.
 *
 * ⚠️ A tag may span a line break, so these are not the stored lines with their
 * tags stripped one by one: the whole block is read as one stretch and broken
 * again, and a block whose markup swallows a newline has fewer lines than it
 * stores.
 */
export function shownLinesOf(block: TextLayerEntry): readonly string[] {
  return linesOf(plainOf(shownCodeOf(block)))
}

/**
 * One side read as a single stretch: every block in reading order, joined by
 * `BLOCK_JOINER`. Worked out every time and never written down.
 */
export function projectionOf(page: FacePage, unit: TranslationUnit, side: TextSide): string {
  return blocksOf(page, unit, side)
    .map((block) => plainOf(shownCodeOf(block)))
    .join(BLOCK_JOINER)
}

/** The same stretch with its markup still on, which is what an agent reads. */
export function projectionCodeOf(page: FacePage, unit: TranslationUnit, side: TextSide): string {
  return blocksOf(page, unit, side).map(shownCodeOf).join(BLOCK_JOINER)
}

/**
 * Whether a sentence reads as nothing at all in this face — which is not the
 * same as having typed nothing into it: a block reading a candidate is
 * translated.
 */
export function isUntranslated(page: FacePage, unit: TranslationUnit): boolean {
  return translationBlocksOf(page, unit).every((block) => plainOf(shownCodeOf(block)).trim() === '')
}

/** A sentence holding one block a side, which is what an ordinary balloon is. */
export function isSingleton(page: FacePage, unit: TranslationUnit): boolean {
  return blocksOf(page, unit, 'source').length === 1 && blocksOf(page, unit, 'translation').length === 1
}

/** What a sentence means: the tags of every block of the artwork it holds, together. */
export function tagsOfUnit(page: FacePage, unit: TranslationUnit): string[] {
  return normalizeTagSet(sourceBlocksOf(page, unit).flatMap((block) => block.body.tags))
}

/** What the sentence a block belongs to in this face means; nothing for a block in none. */
export function tagsOfBlock(page: FacePage, blockId: string): string[] {
  const unit = unitOfBlock(page, blockId)
  return unit === undefined ? [] : tagsOfUnit(page, unit)
}
