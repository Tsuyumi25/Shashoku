import type { TextLayerEntry } from '@shared/page/types'

export type WithdrawPlan = { action: 'refuse'; reason: string } | { action: 'remove' }

/**
 * Withdrawal is the one removal the tool surface allows, and only of what the
 * caller itself put there: unmarked, unchosen, and stamped with the same
 * client. Everything else is either a person's work or another client's
 * proposal, and cleaning up must never double as destroying.
 */
export function planWithdraw(
  entry: TextLayerEntry | undefined,
  translationId: string,
  source: string | undefined,
): WithdrawPlan {
  if (!entry) return { action: 'refuse', reason: '物件不存在' }
  const candidate = entry.translations.find((c) => c.id === translationId)
  if (!candidate) return { action: 'refuse', reason: `候選 ${translationId} 不在這個物件的抽屜裡` }
  if (candidate.human) return { action: 'refuse', reason: '這是人寫過的候選——不可撤' }
  if (entry.translation === translationId) {
    return { action: 'refuse', reason: '這是現值——想換顯示先 choose_translation 到別的候選' }
  }
  if (!candidate.source) {
    return { action: 'refuse', reason: '這則候選沒有署名——不確定是誰的，留給人在介面上清' }
  }
  if (source === undefined || candidate.source !== source) {
    return { action: 'refuse', reason: `這是 ${candidate.source} 的提案——只能撤自己署名的候選` }
  }
  return { action: 'remove' }
}
