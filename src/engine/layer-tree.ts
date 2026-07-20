// 圖層樹的 runtime 型別:Layer discriminated union + type guards。
//
// 現況(Stage A):純型別 placeholder,`ShashokuDoc.layers` 仍是扁平
// `RasterLayer[]`;Stage C1 才把 doc.layers 升成 `Layer[]`,
// Stage C2 才讓 text/group node 真正進 tree。
//
// 資料模型分工:
// - RasterLayer 已存於 engine/types.ts,這裡用交集加 `kind` discriminator
//   升等成 RasterLayerNode(現有物件補 `kind: 'raster'` 即可 assignable)。
// - TextLayerNode 只是「z-order 位置持有者」;文字內容仍在 pinia label
//   SSOT,node 持有 labelId ref。
// - GroupLayerNode 有 children 陣列(遞迴 nest);`styleBinding` 有 = 樣式
//   群組(綁 projectMeta.groups[i]),無 = 一般 group(ctrl+G 產生,自由容器)。
//
// 命名對齊 Photoshop / Figma 慣例:node = tree 中的節點,layer = 用戶語彙。

import type { RasterLayer } from './types'

/** Layer 樹上所有節點共有的 metadata。 */
export interface LayerNodeBase {
  id: string
  name: string
  visible: boolean
  locked: boolean
}

/** Raster 圖層節點:現有 RasterLayer + kind discriminator。 */
export type RasterLayerNode = RasterLayer & { kind: 'raster' }

/**
 * 文字圖層節點:實體存在圖層樹中(可調 z-order、放進 group folder),
 * 但**內容**(text / x / y / groupId / styleOverride)仍在 pinia label
 * (SSOT);node 只持 labelId 作 ref。
 */
export interface TextLayerNode extends LayerNodeBase {
  kind: 'text'
  labelId: string
}

/**
 * Group 圖層節點:PS 意義的 layer folder,純 z-order 容器
 * (現階段不做離屏合成,children 依序疊在自己所在的堆疊位置)。
 *
 * - `styleBinding.labelGroupId` 有值 = **樣式群組**,綁到
 *   `projectMeta.groups[i].id`,打開頁時 auto-populate 對應 label 的
 *   text layer;順序由 projectMeta.groups 順序驅動(全書級)。
 * - 無 styleBinding = **一般 group**,ctrl+G 產生,每頁自由排布。
 */
export interface GroupLayerNode extends LayerNodeBase {
  kind: 'group'
  children: Layer[]
  styleBinding?: { labelGroupId: string }
}

export type Layer = RasterLayerNode | TextLayerNode | GroupLayerNode

// ── type guards(供 tree walk / composite pipeline 分流用) ──

export function isRasterLayer(l: Layer): l is RasterLayerNode {
  return l.kind === 'raster'
}
export function isTextLayer(l: Layer): l is TextLayerNode {
  return l.kind === 'text'
}
export function isGroupLayer(l: Layer): l is GroupLayerNode {
  return l.kind === 'group'
}
export function isStyleGroup(l: Layer): l is GroupLayerNode & { styleBinding: { labelGroupId: string } } {
  return l.kind === 'group' && l.styleBinding !== undefined
}
