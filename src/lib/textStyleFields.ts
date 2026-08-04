import type { TextStyle } from '@shared/text-style/types'

/**
 * What each style field is called where a person reads it — in a batch's name,
 * in a provenance note, in the heading of a bucket. One table so that the same
 * field cannot be 字級 in one panel and 字體大小 in the next.
 */
export const TEXT_STYLE_FIELD_NAMES: Record<keyof TextStyle, string> = {
  fontFamily: '字型',
  fontSizePx: '字級',
  direction: '方向',
  align: '對齊',
  color: '文字色',
  leadingPercent: '行距',
  effects: '效果',
}

/**
 * What a batch calls itself once it has run — the string that lands in every
 * object's provenance. Reads as a sentence in a list of them: 批次改字型.
 */
export function batchLabelFor(patch: Partial<TextStyle>): string {
  const names = (Object.keys(patch) as (keyof TextStyle)[]).map(
    (field) => TEXT_STYLE_FIELD_NAMES[field],
  )
  return `批次改${names.join('、')}`
}
