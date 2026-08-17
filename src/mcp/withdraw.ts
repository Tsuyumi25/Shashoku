import type { TextLayerEntry } from '@shared/page/types'

export type WithdrawPlan =
  | { action: 'refuse'; reason: string }
  | { action: 'remove'; wasChosen: boolean }

/**
 * Withdrawal is the one removal the tool surface allows, and only of what the
 * caller itself put there: unmarked and stamped with the same client. A
 * person's work and another client's proposal are refused — cleaning up must
 * never double as destroying.
 *
 * Being chosen does not protect a candidate: a choose-then-withdraw pair
 * reaches the same end anyway, so refusing it would be friction posing as
 * protection. Withdrawing the current choice falls the object back to its own
 * lines, which nothing ever overwrites.
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
  if (!candidate.source) {
    return { action: 'refuse', reason: '這則候選沒有署名——不確定是誰的，留給人在介面上清' }
  }
  if (source === undefined || candidate.source !== source) {
    return { action: 'refuse', reason: `這是 ${candidate.source} 的提案——只能撤自己署名的候選` }
  }
  return { action: 'remove', wasChosen: entry.translation === translationId }
}
