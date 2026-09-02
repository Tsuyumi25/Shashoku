import type { ManifestJson, TranslationUnit } from '@shared/page/types'
import type { ProposeItem } from '@shared/mcp/types'
import { projectionOf } from '@shared/page/units'

export type ProposalPlan =
  | { action: 'refuse'; reason: string }
  | { action: 'append'; pieces: string[][]; fillSlot: boolean }

/**
 * What a caller sent, as blocks. `lines` means one block, which is what an
 * ordinary proposal is; sending both is a caller that has not decided which it
 * means, and is refused rather than resolved by precedence.
 */
function piecesOf(item: ProposeItem): string[][] | null {
  if (item.pieces !== undefined && item.lines !== undefined) return null
  if (item.pieces !== undefined) return item.pieces
  if (item.lines !== undefined) return [item.lines]
  return null
}

/**
 * The one decision the write tool makes, kept pure so it can be stated and
 * tested apart from the store that carries it out.
 *
 * A proposal only ever appends. The slot is filled as a courtesy exactly when
 * the translation reads as nothing at all — no chosen candidate and nothing
 * typed into any of its blocks — because only then is there nothing anyone
 * decided that the fill would displace. Typed-but-unchosen words count as a
 * decision.
 *
 * ⚠️ And only when the proposal has a block for every block the lettering is
 * set in. Filling a slot the blocks cannot read from would put words on the
 * page that no block is showing.
 */
export function planProposal(
  page: ManifestJson,
  unit: TranslationUnit | undefined,
  item: ProposeItem,
): ProposalPlan {
  if (!unit) return { action: 'refuse', reason: '這一筆翻譯不存在' }
  const pieces = piecesOf(item)
  if (pieces === null) {
    return { action: 'refuse', reason: 'lines 和 pieces 請只給一個——兩個都給說不出要哪個' }
  }
  if (pieces.length === 0) return { action: 'refuse', reason: 'pieces 是空的——沒有內容可收' }
  const lines = pieces.flat()
  if (lines.length === 0) return { action: 'refuse', reason: 'lines 是空的——沒有內容可收' }
  if (lines.some((l) => l.includes('\n'))) {
    return { action: 'refuse', reason: 'lines 的一項不可內含換行——一行一項' }
  }
  if (lines.every((l) => l.trim() === '')) {
    return { action: 'refuse', reason: '每一行都是空白——沒有內容可收' }
  }
  // ⚠️ Reads as nothing, which is not the same as holding no characters. A
  // translation left standing on a few empty lines is as blank as one holding
  // none, and comparing the joined text against "" calls it written-in because
  // the newlines between them are characters.
  const blank = projectionOf(page.layers, unit, 'translation').trim().length === 0
  return {
    action: 'append',
    pieces,
    fillSlot:
      unit.chosen === null && blank && pieces.length === unit.translation.members.length,
  }
}
