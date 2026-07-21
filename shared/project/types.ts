// shashoku/project.json 的型別定義。
// 專案級 metadata:groups + defaultStyle + comment + glossary + exportConfig,全書一份。
// 對應的 per-page 資料在 shared/page/types.ts (ManifestJson / TranslationJson / OcrJson)。
//
// v2 (2026-07):groups 從 string[] 升級成 StyleGroup[](各帶 color + style
// preset);新增 defaultStyle 作為樣式繼承鍊的 fallback。渲染樣式優先序:
// `label.styleOverride` > `groups[label.groupId].style` > `defaultStyle`。
// SskExportConfig 保留匯出配置(docTemplate / outputFormat / exportGroups...);
// 其中的渲染樣式欄位(font / fontSizePx / textColor / textDirection /
// textLeadingPercent)在 Stage B 會退役,改由 defaultStyle 承擔。

import type { SskExportConfig } from '../ssk/types'
import type { TextStyle } from '../text-style/types'

export const PROJECT_SCHEMA_VERSION = 2

/** 術語表:key = 原文,value = 建議譯文;應用內查詢/替換用。 */
export type Glossary = Record<string, string>

/**
 * 樣式群組:承載「一群文字共用什麼排版樣式」的專案級 preset,
 * 對應 LabelPlus 老架構的 group name + PS-Script template PSD 兩件套。
 *
 * `id` 是穩定 UUID,label.groupId 指到此;name 是顯示名(可改不影響綁定);
 * color 是圖示/badge 顯示色;style 是繼承鍊中間層(用戶可 label 級 override)。
 */
export interface StyleGroup {
  id: string
  name: string
  color: string
  style: TextStyle
}

/** shashoku/project.json 的完整結構。 */
export interface ProjectJson {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  /** 樣式群組陣列(有序,index 對應顯示順序);無數量上限;name 禁保留字 */
  groups: StyleGroup[]
  /** 樣式繼承鍊終極 fallback:label 無 groupId 且無 override 時使用 */
  defaultStyle: TextStyle
  /** 專案備註,自由文字 */
  comment: string
  /** 應用內術語一致性支援;暫時放這裡,規模大再拆獨立檔 */
  glossary?: Glossary
  exportConfig: SskExportConfig
}
