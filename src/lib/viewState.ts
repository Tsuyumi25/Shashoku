// 全域視角狀態:兩個 mode 的中央預覽共用同一份變換,切視圖繼承座標與
// 縮放。前提是兩個中欄幾何一致(三欄佈局解耦 + 共用底部列之後成立),
// 同一份 tx/ty/scale/rotate 在兩邊落在同一個畫面位置。
import { reactive } from "vue";
import type { ViewTransform } from "./coords";

export const sharedView = reactive<ViewTransform>({ scale: 1, tx: 0, ty: 0, rotate: 0 });

/**
 * 視角已為哪一頁 fit 過。自動 fit(頁載入)先查它:換頁要重 fit,
 * 切視圖不要——同一頁另一個 mode 已 fit 過(或用戶已調過視角)就繼承。
 * 用戶主動 fit(底部列、Esc 連按、0 鍵)不查,永遠執行。
 */
export const viewFit = { page: null as string | null };
