// 標籤文字樣式的單一來源:翻譯 mode(DOM overlay)與嵌字 mode(canvas
// fallback 節點)套同一份 CSS → 同一個 Chromium 排版結果。「統一文字渲染」
// 統一的是排版源——翻譯側純顯示用 DOM 就夠(CSS transform 下向量銳利),
// 嵌字側要進像素合成才走 drawElementImage(lib/labelPaint.ts)。
//
// 樣式解析走繼承鍊 `defaultStyle → groupStyle → label.styleOverride`(diff 存
// 法);shared/text-style/types.ts 的 TextStyle 是 SSOT,本檔 alias 供既有
// 呼叫端沿用名稱。
import type { LabelItem, ProjectHeader } from '@/types/project'
import type { TextStyle } from '@shared/text-style/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'

/** @deprecated 用 TextStyle;此 alias 是 Stage B 過渡期給既有呼叫端的名稱橋。 */
export type LabelTextStyle = TextStyle
/** @deprecated 用 DEFAULT_TEXT_STYLE。 */
export const DEFAULT_LABEL_TEXT_STYLE: TextStyle = DEFAULT_TEXT_STYLE
export type LabelTextDirection = TextStyle['direction']

/**
 * 樣式繼承鍊 `defaultStyle → groupStyle → label.styleOverride`:
 * - 無 groupId → 跳過 group 那層
 * - groupId 指向已刪除的 group → 視同無 groupId(容錯:normalize 才會清)
 * - styleOverride 是 diff(Partial),空物件等同無 override
 */
export function effectiveStyleForLabel(
  label: Pick<LabelItem, 'groupId' | 'styleOverride'>,
  header: Pick<ProjectHeader, 'groups' | 'defaultStyle'>,
): TextStyle {
  const groupStyle =
    label.groupId === null
      ? undefined
      : header.groups.find((g) => g.id === label.groupId)?.style
  return {
    ...header.defaultStyle,
    ...(groupStyle ?? {}),
    ...(label.styleOverride ?? {}),
  }
}

/**
 * 文字節點的 CSS:顯式斷行(white-space: pre)+ 直排交給 writing-mode,
 * 節點以 doc px 排版。設定面板輸入中的暫時空值(空字型名 / 非正數字級 /
 * 非正 leadingPercent)退回預設,不讓排版塌掉。
 */
export function labelTextCss(style: TextStyle): Record<string, string> {
  const fontSizePx =
    Number.isFinite(style.fontSizePx) && style.fontSizePx > 0
      ? style.fontSizePx
      : DEFAULT_TEXT_STYLE.fontSizePx
  const leadingPercent =
    Number.isFinite(style.leadingPercent) && style.leadingPercent > 0
      ? style.leadingPercent
      : DEFAULT_TEXT_STYLE.leadingPercent
  return {
    fontFamily: style.fontFamily.trim() || DEFAULT_TEXT_STYLE.fontFamily,
    fontSize: `${fontSizePx}px`,
    lineHeight: String(leadingPercent / 100),
    color: style.color,
    whiteSpace: 'pre',
    writingMode: style.direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
    textAlign: 'center',
    width: 'max-content',
  }
}
