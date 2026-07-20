// 文字排版樣式的純資料型別。
// 消費者(refactor 進行中,分階段接進來):
// - shared/project/types.ts:ProjectJson.defaultStyle(全書 fallback)
//                          + ProjectJson.groups[].style(樣式群組 preset)
// - src/types/project.ts:LabelItem.styleOverride?: Partial<TextStyle>(label 個別覆寫)
//
// 樣式解析鍊(渲染時):{ ...defaultStyle, ...groupStyle, ...label.styleOverride }
// group style 是「預設繼承」不是「強制套用」,label 可個別覆寫。
//
// 檔案 policy 對齊 shared/ssk/types.ts:純資料形狀,禁止引用任何標準庫型別
// (PS 端匯出腳本使用 ES3 tsconfig 消費相同型別)。

export type TextDirection = 'horizontal' | 'vertical'

/**
 * 排版樣式的完整形狀(所有欄位皆有值,無 null / undefined)。
 * override 用 Partial<TextStyle> 表達差異;解析時逐欄 spread 合併。
 */
export interface TextStyle {
  /** 字體家族名;PS 端寫入 textItem.font 需完整字型名(如 'SimSun') */
  fontFamily: string
  /** 原圖像素字級;PS 端匯出時依 PSD resolution 換算成 pt */
  fontSizePx: number
  /** 文字方向;PS 端對應 textItem.direction(HORIZONTAL / VERTICAL) */
  direction: TextDirection
  /** sRGB 顏色 (#rrggbb);Canvas 預覽與 PS 文字圖層共用 */
  color: string
  /** 行距百分比(120 = line-height 1.2);寫入 CSS lineHeight = leadingPercent / 100 */
  leadingPercent: number
}

/** 全新專案的 defaultStyle 種子(不含 group 樣式,由 defaultProjectJson 各自種) */
export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'sans-serif',
  fontSizePx: 24,
  direction: 'horizontal',
  color: '#000000',
  leadingPercent: 120,
}
