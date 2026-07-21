// per-page 資料的型別定義:
// shashoku/pages/<basename>/{manifest.json, translation.json, ocr.json?, layers/*.png}
//
// 三個 JSON 各自可獨立 parse:
// - manifest.json 是 commit 錨點,永遠最後寫;引用 layers/*.png
// - translation.json 存這頁的 label 標號 + 譯文
// - ocr.json 選用,存 OCR 偵測結果

import type { SskLabel } from '../ssk/types'

/** v2 (2026-07):LayerEntry 從單一 raster 型別升成 raster/text/group 三種
 * discriminated union(kind 欄位),支援樹狀 nest。POC 硬斷,v1 檔讀不進來。 */
export const MANIFEST_SCHEMA_VERSION = 2
/** v2 (2026-07):label.category:int → label.groupId: string | null(對應
 * ProjectJson.groups[].id);新增 label.styleOverride?: Partial<TextStyle>。 */
export const TRANSLATION_SCHEMA_VERSION = 2
export const OCR_SCHEMA_VERSION = 1

/** LayerEntry 共用的節點 metadata(對應 layer-tree.ts 的 LayerNodeBase)。 */
interface LayerEntryBase {
  /** UUID,jsx / undo 追蹤用 */
  id: string
  name: string
  visible: boolean
  locked: boolean
}

/** Raster 圖層:實體像素在 layers/<file>.png。 */
export interface RasterLayerEntry extends LayerEntryBase {
  kind: 'raster'
  /** 相對 pages/<basename>/layers/ 的檔名(不含目錄),例如 "background.png" */
  file: string
  /** 0..1 */
  opacity: number
  /** Canvas 原生 blend mode(16 種);白名單於 schema.ts */
  blendMode: string
  alphaLocked: boolean
}

/** 文字圖層:z-order 佔位;內容(text / x / y / groupId / styleOverride)
 * 仍在 translation.json 的 SskLabel(SSOT),此節點只持 labelId 作 ref。 */
export interface TextLayerEntry extends LayerEntryBase {
  kind: 'text'
  labelId: string
}

/** Group 圖層:PS 意義的 layer folder,純 z-order 容器(不做離屏合成)。
 * - styleBinding 有值 = 樣式群組(綁 project.groups[i].id),打開頁時
 *   auto-populate 對應 label 的 text layer
 * - 無 styleBinding = 一般 group(ctrl+G 產生,自由容器) */
export interface GroupLayerEntry extends LayerEntryBase {
  kind: 'group'
  children: LayerEntry[]
  styleBinding?: { labelGroupId: string }
}

export type LayerEntry = RasterLayerEntry | TextLayerEntry | GroupLayerEntry

/** 每頁 manifest.json 的完整結構。 */
export interface ManifestJson {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  /**
   * 每次 autosave 遞增的 revision counter,用於「生成式檔名」pattern:
   * layers/<layer-id>.rev<N>.png。同一頁的舊 rev PNG 保留不覆寫,直到
   * openProject 時 GC。防止「manifest 是舊、layers 是新舊混合」的
   * 多檔 transaction race。初始值 0(空 manifest);第一次寫入變 1。
   */
  revision: number
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
