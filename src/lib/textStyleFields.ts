import type { TextStyle } from '@shared/text-style/types'

/**
 * What each style field is called where a person reads it — in the compare
 * picker, in the heading of a bucket. One table so that the same field cannot
 * be 字級 in one panel and 字體大小 in the next.
 */
export const TEXT_STYLE_FIELD_NAMES: Record<keyof TextStyle, string> = {
  fontFamily: '字型',
  fontFace: '字款',
  fontStyleName: '字重',
  fontSizePx: '字級',
  direction: '方向',
  align: '對齊',
  color: '文字色',
  leadingPercent: '行距',
  weightPx: '字粗',
  effects: '效果',
}

/** One field's value as a person reads it, in the same words wherever it is shown. */
export function styleFieldText(style: TextStyle, field: keyof TextStyle): string {
  const value = style[field]
  if (field === 'fontFamily' || field === 'fontFace' || field === 'fontStyleName')
    return (value as string) || '未指定'
  if (field === 'fontSizePx') return `${value as number}px`
  if (field === 'leadingPercent') return `${value as number}%`
  if (field === 'direction') return value === 'vertical' ? '直排' : '橫排'
  if (field === 'align') return { start: '起', center: '中', end: '末' }[value as string] ?? ''
  if (field === 'effects') return (value as unknown[]).length === 0 ? '無' : '描邊'
  return String(value)
}
