import type { TranslationUnit } from '@shared/page/types'

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
 * protection. Withdrawing the current choice falls the translation back to the
 * words in its own blocks, which nothing ever overwrites.
 */
export function planWithdraw(
  unit: TranslationUnit | undefined,
  translationId: string,
  source: string | undefined,
): WithdrawPlan {
  if (!unit) return { action: 'refuse', reason: '這一筆翻譯不存在' }
  const candidate = unit.candidates.find((c) => c.id === translationId)
  if (!candidate) return { action: 'refuse', reason: `候選 ${translationId} 不在這一筆的抽屜裡` }
  if (candidate.human) return { action: 'refuse', reason: '這是人寫過的候選——不可撤' }
  if (!candidate.source) {
    return { action: 'refuse', reason: '這則候選沒有署名——不確定是誰的，留給人在介面上清' }
  }
  if (source === undefined || candidate.source !== source) {
    return { action: 'refuse', reason: `這是 ${candidate.source} 的提案——只能撤自己署名的候選` }
  }
  return { action: 'remove', wasChosen: unit.chosen === translationId }
}
