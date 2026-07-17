// 標籤文字樣式的單一來源:翻譯 mode(DOM overlay)與嵌字 mode(canvas
// fallback 節點)套同一份 CSS → 同一個 Chromium 排版結果。「統一文字渲染」
// 統一的是排版源——翻譯側純顯示用 DOM 就夠(CSS transform 下向量銳利),
// 嵌字側要進像素合成才走 drawElementImage(lib/labelPaint.ts)。
import type { SskExportConfig } from '@shared/ssk/types'

export type LabelTextDirection = 'horizontal' | 'vertical'

export interface LabelTextStyle {
  fontFamily: string
  fontSizePx: number
  direction: LabelTextDirection
  color: string
}

export const DEFAULT_LABEL_TEXT_STYLE: LabelTextStyle = {
  fontFamily: 'sans-serif',
  fontSizePx: 24,
  direction: 'horizontal',
  color: '#000000',
}

/** 畫布與工程檔都以原圖 px 表示字級;樣式欄位沿用會寫入工程檔的同一份 exportConfig。 */
export function labelTextStyleFromExportConfig(config: SskExportConfig): LabelTextStyle {
  return {
    fontFamily: config.font ?? DEFAULT_LABEL_TEXT_STYLE.fontFamily,
    fontSizePx: config.fontSizePx ?? DEFAULT_LABEL_TEXT_STYLE.fontSizePx,
    direction: config.textDirection === 'vertical' ? 'vertical' : 'horizontal',
    color: config.textColor,
  }
}

/**
 * 文字節點的 CSS:顯式斷行(white-space: pre)+ 直排交給 writing-mode,
 * 節點以 doc px 排版。設定面板輸入中的暫時空值(空字型名 / 非正數字級)
 * 退回預設,不讓排版塌掉。
 */
export function labelTextCss(style: LabelTextStyle): Record<string, string> {
  const fontSizePx =
    Number.isFinite(style.fontSizePx) && style.fontSizePx > 0
      ? style.fontSizePx
      : DEFAULT_LABEL_TEXT_STYLE.fontSizePx
  return {
    fontFamily: style.fontFamily.trim() || DEFAULT_LABEL_TEXT_STYLE.fontFamily,
    fontSize: `${fontSizePx}px`,
    lineHeight: '1.2',
    color: style.color,
    whiteSpace: 'pre',
    writingMode: style.direction === 'vertical' ? 'vertical-rl' : 'horizontal-tb',
    textAlign: 'center',
    width: 'max-content',
  }
}
