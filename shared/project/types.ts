// shashoku/project.json 的型別定義。
// 專案級 metadata:groups + comment + glossary + exportConfig,全書一份。
// 對應的 per-page 資料在 shared/ssk/types.ts (ManifestJson / TranslationJson / OcrJson)。

import type { SskExportConfig } from '../ssk/types'

export const PROJECT_SCHEMA_VERSION = 1

/** 術語表:key = 原文,value = 建議譯文;應用內查詢/替換用。 */
export type Glossary = Record<string, string>

/** shashoku/project.json 的完整結構。 */
export interface ProjectJson {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  /** index 0 = category 1;上限 MAX_GROUPS;禁止保留字(RESERVED_GROUP_NAMES) */
  groups: string[]
  /** 專案備註,自由文字 */
  comment: string
  /** 應用內術語一致性支援;暫時放這裡,規模大再拆獨立檔 */
  glossary?: Glossary
  exportConfig: SskExportConfig
}
