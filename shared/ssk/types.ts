// 專案級型別:label 資料模型 + 匯出設定。
// 新架構下:SskLabel 被 shared/page/schema 的 TranslationJson 引用;
// SskExportConfig 被 shared/project/schema 的 ProjectJson 引用。
// 檔案內只允許純資料形狀:string/number/boolean/null/array/字面量聯合,禁止引用任何標準庫型別
// (因為 Photoshop 匯出腳本使用 ES3 tsconfig 消費相同型別)。

import type { TextStyle } from '../text-style/types'

export interface SskLabel {
  /** 前端追蹤用 UUID;jsx 端不使用 */
  id: string
  /** X 座標,相對原圖寬度 ∈ [0,1] */
  x: number
  /** Y 座標,相對原圖高度 ∈ [0,1] */
  y: number
  /**
   * 樣式群組綁定;對應 ProjectJson.groups[].id;null = 未綁 group
   * (樣式走 project.defaultStyle,label 出現在圖層樹 root)。
   */
  groupId: string | null
  /** 譯文行陣列:每元素一行,禁止內嵌換行(手動斷行顯式化) */
  lines: string[]
  /**
   * 個別樣式覆寫(diff 存法,只存跟 group style 不同的欄位);
   * 樣式解析鍊:{ ...projectDefault, ...groupStyle, ...styleOverride }。
   * group style 是預設繼承,不是強制套用——支援用戶顆粒度差異。
   */
  styleOverride?: Partial<TextStyle>
  /**
   * z-order 錨定:label 渲染在此 layer 之上、下一 layer 之下(scene 疊層)。
   * undefined = 未錨定(繪製在所有 layer 上方,即傳統 label overlay 位置)。
   * layerId 對應 ManifestJson.layers[].id;若對應 layer 消失,渲染時視為未錨定。
   *
   * **過渡欄位**:Stage C2 隨 text layer 進圖層樹一併退役(z-order 由 tree
   * 位置驅動),屆時從 schema 全砍。目前 Stage A/B 保留維持既有錨定行為。
   */
  anchorLayerId?: string
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
