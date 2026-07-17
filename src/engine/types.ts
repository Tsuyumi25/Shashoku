// Shashoku 像素引擎的核心型別。
// 座標與尺寸一律是「文件像素」(doc px)整數；顏色是直通 alpha 的 RGBA。

import type { BlendMode } from "./blend";

/** 文件像素座標系裡的整數矩形（用於 dirty-rect 合成範圍）。 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 一個 raster 圖層。POC 用「整張文件大小的 buffer」最簡單直白，
 * 代價是每層 w*h*4 bytes（1500×2100 ≈ 12.6MB）。生產版會換成 tile，
 * 但 dirty-rect 合成的成本模型跟儲存方式無關，POC 先驗合成這一半。
 */
export interface RasterLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  blendMode: BlendMode;
  /** 完全鎖定：像素編輯一律跳過（在工具層守門，引擎保持純粹）。 */
  locked: boolean;
  /** 鎖定透明像素（PS 語意）：畫筆只改已有像素的顏色、不改 alpha；擦除無效。 */
  alphaLocked: boolean;
  /** w*h*4，直通（非預乘）alpha 的 RGBA。 */
  data: Uint8ClampedArray;
}
