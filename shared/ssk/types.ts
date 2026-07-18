// .ssk.json 工程檔 schema v1 的型別定義。
// 這個檔案同時被 app(現代 TS)與 Photoshop 匯出腳本(ES3/noLib tsconfig)消費,
// 只允許純資料形狀:string/number/boolean/null/array/字面量聯合,禁止引用任何標準庫型別。

export const SSK_VERSION = 1

export interface SskProject {
  version: typeof SSK_VERSION
  /** index 0 = category 1;上限 MAX_GROUPS;禁止保留字(RESERVED_GROUP_NAMES) */
  groups: string[]
  comment: string
  /** 陣列順序 = 頁序 = 匯出順序 */
  images: SskImage[]
  exportConfig: SskExportConfig
}

export interface SskImage {
  /** basename;圖源資料夾 = .ssk.json 所在資料夾(零配置慣例) */
  filename: string
  labels: SskLabel[]
}

export interface SskLabel {
  /** 前端追蹤用 UUID;jsx 端不使用 */
  id: string
  /** X 座標,相對原圖寬度 ∈ [0,1] */
  x: number
  /** Y 座標,相對原圖高度 ∈ [0,1] */
  y: number
  /** 分組編號 1~groups.length,對應 groups[category-1] */
  category: number
  /** 譯文行陣列:每元素一行,禁止內嵌換行(手動斷行顯式化) */
  lines: string[]
}

export type DocTemplateMode = 'auto' | 'none' | 'custom'
export type TextDirectionMode = 'keep' | 'horizontal' | 'vertical'
export type OutputFormat = 'psd' | 'tiff' | 'png' | 'jpg'

export interface SskExportConfig {
  docTemplate: DocTemplateMode
  /** 相對專案資料夾的檔名(不含路徑分隔符,保工程檔可攜);僅 docTemplate === 'custom' 時使用 */
  docTemplateFilename: string | null
  outputFormat: OutputFormat
  ignoreNoLabelImages: boolean
  /** 是否為每個分組建立 LayerSet(對應舊腳本 noLayerGroup 取反) */
  createLayerGroups: boolean
  /** null = 沿用模板/PS 預設 */
  font: string | null
  /** 原圖像素字級；JSX 依 PSD resolution 換算成 pt。null = 預設 24px */
  fontSizePx: number | null
  /** Canvas 預覽與 Photoshop 文字圖層共用的 sRGB 顏色（#rrggbb） */
  textColor: string
  /** 自動行距百分比;null = PS 預設 */
  textLeadingPercent: number | null
  textDirection: TextDirectionMode
  /** 是否額外輸出標號圖層(_Label LayerSet) */
  outputLabelIndex: boolean
  /** PS Action 組名(_start/_end/分組名鉤子);null = 停用 */
  actionSetName: string | null
  /** 輸出子資料夾名(相對專案資料夾,不含路徑分隔符);null = 預設 'ssk_output' */
  outputFolderName: string | null
  /** 要匯出的分組子集;null = 全部 */
  exportGroups: string[] | null
}
