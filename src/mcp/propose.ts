import type { TranslationTextLayerEntry } from '@shared/page/types'
import type { ProposeItem } from '@shared/mcp/types'
import { plainOf } from '@shared/page/markup'
import { shownCodeOf } from '@shared/page/units'

export type ProposalPlan =
  | { action: 'refuse'; reason: string }
  | { action: 'append'; lines: string[]; fillSlot: boolean }

/**
 * The one decision the write tool makes, kept pure so it can be stated and
 * tested apart from the store that carries it out.
 *
 * A proposal only ever appends, to the drawer of the one block it names.
 * Unasked, that block's slot is filled as a courtesy exactly when the block
 * reads as nothing at all — no chosen candidate and nothing typed into it —
 * because only then is there nothing anyone decided that the fill would
 * displace. Typed-but-unchosen words count as a decision. Asked with `choose`,
 * the slot moves whatever it held: the earlier choice stays in the drawer.
 */
export function planProposal(
  block: TranslationTextLayerEntry,
  item: Pick<ProposeItem, 'lines' | 'choose'>,
): ProposalPlan {
  const { lines } = item
  if (lines.length === 0) return { action: 'refuse', reason: 'lines 是空的——沒有內容可收' }
  if (lines.some((l) => l.includes('\n'))) {
    return { action: 'refuse', reason: 'lines 的一項不可內含換行——一行一項' }
  }
  if (lines.every((l) => l.trim() === '')) {
    return { action: 'refuse', reason: '每一行都是空白——沒有內容可收' }
  }
  // ⚠️ Reads as nothing, which is not the same as holding no characters. A
  // block left standing on a few empty lines is as blank as one holding none,
  // and comparing the joined text against "" calls it written-in because the
  // newlines between them are characters.
  const blank = plainOf(shownCodeOf(block)).trim().length === 0
  return {
    action: 'append',
    lines,
    fillSlot: item.choose === true || (block.body.chosen === null && blank),
  }
}
