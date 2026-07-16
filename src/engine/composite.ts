import type { RasterLayer, Rect } from "./types";

/**
 * 純 CPU、逐像素的 source-over 合成 —— 把 `layers`(bottom→top)在矩形 `r`
 * 範圍內疊進 `out`(w*h*4)。
 *
 * 角色定位(看過 BitMappery 範本後修正):顯示路徑其實不用這個。範本(zcanvas)
 * 跟本 POC 的顯示合成都走「每層一個 canvas → drawImage 疊起來」,由瀏覽器 2D
 * compositor(GPU 加速)處理,還免費得到 globalCompositeOperation 的 PS 混合模式。
 *
 * 這個函式留作兩用:(1) 匯出壓平的 CPU 路;(2) 效能 HUD 的量測儀器 —— 跑一次
 * 全畫面,量「如果真的要手刻 CPU 合成(例如某個瀏覽器沒有的自訂混合模式)成本
 * 多少」,好判斷那種情況下 WASM 何時才划算。刻意寫成無框架依賴的純函式:hot loop
 * 要換成 wasm(同樣吃一組 buffer + 一個 rect)時,呼叫端不用動。
 */
export function compositeRect(
  layers: RasterLayer[],
  out: Uint8ClampedArray,
  w: number,
  r: Rect,
): void {
  const { x, y, h } = r;
  const rw = r.w;

  for (let row = 0; row < h; row++) {
    const py = y + row;
    let idx = (py * w + x) * 4;
    for (let col = 0; col < rw; col++, idx += 4) {
      // 每個像素從全透明開始,由下往上 source-over 疊。
      let dr = 0,
        dg = 0,
        db = 0,
        da = 0;

      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        if (!layer.visible || layer.opacity === 0) continue;
        const s = layer.data;
        const sa = (s[idx + 3] / 255) * layer.opacity;
        if (sa === 0) continue;

        const inv = 1 - sa;
        const outA = sa + da * inv;
        if (outA === 0) continue;
        // 直通 alpha 的 source-over。sr/sg/sb 是 0..255。
        dr = (s[idx] * sa + dr * da * inv) / outA;
        dg = (s[idx + 1] * sa + dg * da * inv) / outA;
        db = (s[idx + 2] * sa + db * da * inv) / outA;
        da = outA;
      }

      out[idx] = dr;
      out[idx + 1] = dg;
      out[idx + 2] = db;
      out[idx + 3] = da * 255;
    }
  }
}
