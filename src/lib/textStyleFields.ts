import type { TextStyle } from '@shared/text-style/types'

/**
 * What each style field is called where a person reads it — in the compare
 * picker, in the heading of a bucket. One table so that the same field cannot
 * be 字級 in one panel and 字體大小 in the next.
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
