import type { RasterLayer } from "./types";
import { compositeRect } from "./composite";

/** 量一段同步操作的毫秒數(performance.now,renderer 端可用)。 */
export function timeMs(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

/**
 * 量「純 CPU、逐像素、全畫面合成」的成本 —— 這是 CPU/WASM 抉擇的關鍵數字。
 * 顯示走 drawImage 用不到它,但如果哪天要一個瀏覽器沒有的自訂混合模式、得手刻
 * CPU 合成,這個 ms 就是「JS 夠不夠、還是得下 WASM」的依據。取多次中位數。
 */
export function benchmarkCpuComposite(
  layers: RasterLayer[],
  w: number,
  h: number,
  iterations = 5,
): number {
  const out = new Uint8ClampedArray(w * h * 4);
  const full = { x: 0, y: 0, w, h };
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    samples.push(timeMs(() => compositeRect(layers, out, w, full)));
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}
