import type { TextAlign, TextDirection, TextStyle } from '@shared/text-style/types'

/**
 * What each alignment is called, which follows the direction the text runs
 * while the value stored does not. Somebody setting a vertical block is asking
 * for the top, not for "start" — and the same file read the other way round has
 * to keep meaning the same thing, which is why only the wording turns.
 */
export const ALIGN_LABELS: Record<TextDirection, Record<TextAlign, string>> = {
  horizontal: { start: '左', center: '中', end: '右' },
  vertical: { start: '上', center: '中', end: '下' },
}

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
  scaleXPercent: '水平縮放',
  scaleYPercent: '垂直縮放',
}

/** One field's value as a person reads it, in the same words wherever it is shown. */
export function styleFieldText(style: TextStyle, field: keyof TextStyle): string {
  const value = style[field]
  if (field === 'fontFamily' || field === 'fontFace' || field === 'fontStyleName')
    return (value as string) || '未指定'
  if (field === 'fontSizePx') return `${value as number}px`
  if (field === 'leadingPercent' || field === 'scaleXPercent' || field === 'scaleYPercent')
    return `${value as number}%`
  if (field === 'direction') return value === 'vertical' ? '直排' : '橫排'
  if (field === 'align') return ALIGN_LABELS[style.direction][value as TextAlign] ?? ''
  return String(value)
}
