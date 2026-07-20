// per-page 資料的型別定義:
// shashoku/pages/<basename>/{manifest.json, translation.json, ocr.json?, layers/*.png}
//
// 三個 JSON 各自可獨立 parse:
// - manifest.json 是 commit 錨點,永遠最後寫;引用 layers/*.png
// - translation.json 存這頁的 label 標號 + 譯文
// - ocr.json 選用,存 OCR 偵測結果

import type { SskLabel } from '../ssk/types'

export const MANIFEST_SCHEMA_VERSION = 1
export const TRANSLATION_SCHEMA_VERSION = 1
export const OCR_SCHEMA_VERSION = 1

/** manifest 內每一層的描述;PNG 資料在 layers/<file> 檔案本身。 */
export interface LayerEntry {
  /** UUID,jsx / undo 追蹤用 */
  id: string
  /** 相對 pages/<basename>/ 的檔名(不含目錄),例如 "background.png" */
  file: string
  name: string
  visible: boolean
  /** 0..1 */
  opacity: number
  /** Canvas 原生 blend mode(16 種);白名單於 schema.ts */
  blendMode: string
  locked: boolean
  alphaLocked: boolean
}

/** 每頁 manifest.json 的完整結構。 */
export interface ManifestJson {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  /** 陣列順序 = layer 堆疊順序(底 → 頂) */
  layers: LayerEntry[]
}

/** 每頁 translation.json 的完整結構。 */
export interface TranslationJson {
  schemaVersion: typeof TRANSLATION_SCHEMA_VERSION
  labels: SskLabel[]
}

// ── OCR 結果(對應 shared/ipc/channels.ts OcrPageResult / OcrBlock)──

export type OcrBlockLabel = 'bubble' | 'text_bubble' | 'text_free'

export interface OcrBlockPersisted {
  x: number
  y: number
  w: number
  h: number
  label: OcrBlockLabel
  score: number
  text?: string
}

export interface OcrJson {
  schemaVersion: typeof OCR_SCHEMA_VERSION
  /** 原圖尺寸,用於座標復原 */
  width: number
  height: number
  blocks: OcrBlockPersisted[]
}
