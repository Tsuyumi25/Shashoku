import { textOf } from '@shared/page/text'
import type { TextLayerEntry } from '@shared/page/types'

export type ProposalPlan =
  | { action: 'refuse'; reason: string }
  | { action: 'append'; fillSlot: boolean }

/**
 * The one decision the write tool makes, kept pure so it can be stated and
 * tested apart from the store that carries it out.
 *
 * A proposal only ever appends. The slot is filled as a courtesy exactly when
 * the object reads as nothing at all — no chosen candidate and no typed lines —
 * because only then is there nothing anyone decided that the fill would
 * displace. Typed-but-unchosen lines count as a decision.
 */
export function planProposal(entry: TextLayerEntry | undefined, lines: string[]): ProposalPlan {
  if (!entry) return { action: 'refuse', reason: '物件不存在' }
  if (lines.length === 0) return { action: 'refuse', reason: 'lines 是空的——沒有內容可收' }
  if (lines.some((l) => l.includes('\n'))) {
    return { action: 'refuse', reason: 'lines 的一項不可內含換行——一行一項' }
  }
  if (lines.every((l) => l.trim() === '')) {
    return { action: 'refuse', reason: '每一行都是空白——沒有內容可收' }
  }
  return { action: 'append', fillSlot: entry.translation === null && textOf(entry) === '' }
}
