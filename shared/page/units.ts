import type {
  LayerEntry,
  ManifestJson,
  SourceTextLayerEntry,
  TextLayerEntry,
  TranslationTextLayerEntry,
  TranslationUnit,
  TranslationUnitSide,
} from './types'
import type { TextSide } from './text'
import { linesOf } from './text'
import { escapeText, plainOf } from './markup'
import { textObjects } from './tree'

/**
 * Which of a translation's two sides the interface is working on.
 *
 * Every surface that shows text, position, angle or style agrees about this, so
 * switching it switches all of them at once — and a caret can never open on one
 * side while the words under it come from the other.
 *
 * ⚠️ The compositor is not one of those surfaces. What a page exports as is
 * always the translation, whatever the interface happens to be showing.
 */
export function sideOf(unit: TranslationUnit, side: TextSide): TranslationUnitSide {
  return side === 'source' ? unit.source : unit.translation
}

/** The blocks on one side, in reading order, skipping any the page has lost. */
export function blocksOf(
  layers: readonly LayerEntry[],
  unit: TranslationUnit,
  side: TextSide,
): TextLayerEntry[] {
  const byId = new Map(textObjects(layers).map((t) => [t.id, t]))
  const out: TextLayerEntry[] = []
  for (const id of sideOf(unit, side).members) {
    const entry = byId.get(id)
    if (entry?.side === side) out.push(entry)
  }
  return out
}

export function sourceBlocksOf(
  layers: readonly LayerEntry[],
  unit: TranslationUnit,
): SourceTextLayerEntry[] {
  return blocksOf(layers, unit, 'source') as SourceTextLayerEntry[]
}

export function translationBlocksOf(
  layers: readonly LayerEntry[],
  unit: TranslationUnit,
): TranslationTextLayerEntry[] {
  return blocksOf(layers, unit, 'translation') as TranslationTextLayerEntry[]
}

/** Only the blocks of one side, in tree order — which is stacking order. */
export function blocksOnSide(layers: readonly LayerEntry[], side: TextSide): TextLayerEntry[] {
  return textObjects(layers).filter((t) => t.side === side)
}

export interface UnitPlace {
  unit: TranslationUnit
  side: TextSide
  /** Which of that side's members this is, counting from zero. */
  at: number
}

/**
 * Which translation a block belongs to, and where in it.
 *
 * A block belongs to exactly one side of exactly one unit, so the answer is
 * unambiguous when the page holds together, and absent when it does not — the
 * repair layer is what makes the first true, and nothing here guesses.
 */
export function placeOfBlock(manifest: ManifestJson, blockId: string): UnitPlace | undefined {
  for (const unit of manifest.translationUnits) {
    const source = unit.source.members.indexOf(blockId)
    if (source !== -1) return { unit, side: 'source', at: source }
    const translation = unit.translation.members.indexOf(blockId)
    if (translation !== -1) return { unit, side: 'translation', at: translation }
  }
  return undefined
}

export function unitOfBlock(
  manifest: ManifestJson,
  blockId: string,
): TranslationUnit | undefined {
  return placeOfBlock(manifest, blockId)?.unit
}

export function findUnit(
  manifest: ManifestJson,
  id: string,
): TranslationUnit | undefined {
  return manifest.translationUnits.find((u) => u.id === id)
}

/**
 * The page as a reader meets it.
 *
 * Built from `readingOrder` alone. A unit the order does not name is absent from
 * the answer rather than recovered from where its blocks sit in the tree: a
 * fallback is how an order someone set reverts to stacking order without ever
 * saying so. Keeping the two in step is the repair layer's job, done once on the
 * way in.
 */
export function unitsInReadingOrder(manifest: ManifestJson): TranslationUnit[] {
  const byId = new Map(manifest.translationUnits.map((u) => [u.id, u]))
  const out: TranslationUnit[] = []
  const seen = new Set<string>()
  for (const id of manifest.readingOrder) {
    if (seen.has(id)) continue
    const unit = byId.get(id)
    if (unit === undefined) continue
    seen.add(id)
    out.push(unit)
  }
  return out
}

/**
 * What one block of the translation side reads as.
 *
 * ⭐ The one place a chosen candidate is resolved, which is what keeps picking
 * one from overwriting anything: the words in the block stay exactly as typed,
 * and emptying the slot brings them back.
 *
 * A slot naming a candidate the pool no longer holds, or one that no longer has
 * a piece for this position, reads as the block's own words — showing nothing
 * would lose them to a dangling pointer.
 */
export function linesAt(unit: TranslationUnit, at: number, own: readonly string[]): readonly string[] {
  if (unit.chosen === null) return own
  return unit.candidates.find((c) => c.id === unit.chosen)?.pieces[at] ?? own
}

/**
 * The markup one block holds on the page, chosen candidate resolved.
 *
 * ⭐ Every surface that draws lettering goes through here — the canvas, the
 * export compositor, the thumbnail's identity — so a chosen candidate cannot be
 * showing on one of them and not another.
 *
 * A source block says its own words and nothing else, which is the last
 * asymmetry between the two sides: nobody proposes readings of the artwork.
 */
export function shownCodeOf(manifest: ManifestJson, block: TextLayerEntry): string {
  if (block.side === 'source') return block.body.lines.join('\n')
  const place = placeOfBlock(manifest, block.id)
  const lines =
    place === undefined ? block.body.lines : linesAt(place.unit, place.at, block.body.lines)
  return lines.join('\n')
}

/**
 * What one block reads as — the words without the markup around them.
 *
 * ⚠️ A tag may span a line break, so these are not the stored lines with their
 * tags stripped one by one: the whole block is read as one stretch and broken
 * again, and a block whose markup swallows a newline has fewer lines than it
 * stores.
 */
export function shownLinesOf(
  manifest: ManifestJson,
  block: TextLayerEntry,
): readonly string[] {
  return linesOf(plainOf(shownCodeOf(manifest, block)))
}

/**
 * One side read as a single stretch of text: every block in order, with what
 * the person put between them.
 *
 * ⭐ Worked out every time and never written down. Moving a block, turning it or
 * restacking it cannot change this, because none of those touch anything it
 * reads — only the words, the order of the blocks, and the separators can.
 */
export function projectionOf(
  layers: readonly LayerEntry[],
  unit: TranslationUnit,
  side: TextSide,
): string {
  const read = blocksOf(layers, unit, side).map((block, at) => {
    const code = block.side === 'translation' ? linesAt(unit, at, block.body.lines) : block.body.lines
    return linesOf(plainOf(code.join('\n')))
  })
  return joinPieces(read, sideOf(unit, side).separators)
}

/**
 * The same stretch with its markup still on, which is what an agent reads and
 * writes. The separators belong to the page rather than to any body, so they
 * are escaped on the way in — a separator holding a `<` is text, not a tag.
 */
export function projectionCodeOf(
  layers: readonly LayerEntry[],
  unit: TranslationUnit,
  side: TextSide,
): string {
  const code = blocksOf(layers, unit, side).map((block, at) =>
    block.side === 'translation' ? linesAt(unit, at, block.body.lines) : block.body.lines,
  )
  return joinPieces(code, sideOf(unit, side).separators.map(escapeText))
}

/**
 * Blocks of lines read as one stretch. Shared by what the page holds and by what
 * a candidate proposes, so a proposal and the thing it would replace are always
 * shown put together the same way.
 */
export function joinPieces(
  pieces: readonly (readonly string[])[],
  separators: readonly string[],
): string {
  return pieces
    .map((lines) => lines.join('\n'))
    .reduce((text, piece, at) => (at === 0 ? piece : text + (separators[at - 1] ?? '') + piece), '')
}

/**
 * Whether a translation reads as nothing at all — which is not the same as
 * having typed nothing into it. A unit whose blocks hold no words but whose slot
 * holds a candidate with text is translated, and every display saying otherwise
 * is reading past the resolution above.
 */
export function isUntranslated(layers: readonly LayerEntry[], unit: TranslationUnit): boolean {
  return projectionOf(layers, unit, 'translation').length === 0
}

/**
 * Whether a candidate can be pointed at as this unit's reading.
 *
 * ⚠️ One piece per block, and nothing here makes that true — a candidate
 * proposing a different number of blocks is a request to typeset the sentence
 * differently, which is a decision about the artwork that no pool entry gets to
 * make on its own.
 */
export function candidateFits(unit: TranslationUnit, candidateId: string): boolean {
  const candidate = unit.candidates.find((c) => c.id === candidateId)
  return candidate !== undefined && candidate.pieces.length === unit.translation.members.length
}

/** A unit holding one block a side, which is what an ordinary balloon is. */
export function isSingleton(unit: TranslationUnit): boolean {
  return unit.source.members.length === 1 && unit.translation.members.length === 1
}
