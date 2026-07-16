// 整頁逐像素濾鏡 —— 這才是 CPU/WASM 抉擇的真正戰場。
// 合成走 drawImage、筆刷走 dirty-rect,都不在熱路徑;唯有「對整頁每個像素做很多次
// 運算」的濾鏡會逼出 WASM。這裡刻意保留兩個對照:重的(分離式高斯模糊,成本隨半徑
// 線性長)和輕的(亮度/對比,單趟),量出來就知道 JS 的天花板在哪、WASM 何時才划算。
//
// 全部寫成無框架依賴的純函式,src→dst 各自獨立 buffer,熱迴圈要原地換 wasm 時
// 呼叫端不用動。alpha 直接沿用 src(漫畫底圖不透明,不需要預乘處理)。

/** 亮度/對比:單趟、每像素常數次運算的「輕」濾鏡基準線。 */
export function brightnessContrast(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  brightness: number, // -1..1,加法位移
  contrast: number, // -1..1,對比係數
): void {
  const b = brightness * 255;
  const c = contrast + 1; // 1 = 不變
  const n = src.length;
  for (let i = 0; i < n; i += 4) {
    dst[i] = (src[i] - 128) * c + 128 + b;
    dst[i + 1] = (src[i + 1] - 128) * c + 128 + b;
    dst[i + 2] = (src[i + 2] - 128) * c + 128 + b;
    dst[i + 3] = src[i + 3];
  }
}

/**
 * 分離式高斯模糊:水平一趟 + 垂直一趟,成本 ≈ 像素數 × (2r+1) × 2 趟 × 3 通道。
 * 這是影像編輯器裡經典的「重」濾鏡,也是各家(含 BitMappery)把它丟 WASM+worker
 * 的原因。半徑越大越能逼出 JS 的極限,拿來當 WASM go/no-go 的直接輸入。
 */
export function gaussianBlur(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.max(1, Math.round(radius));
  const sigma = r / 3 || 1;
  const kernel = buildGaussianKernel(r, sigma);
  const scratch = new Uint8ClampedArray(src.length);

  // 水平趟:src → scratch
  blurPass(src, scratch, w, h, kernel, r, true);
  // 垂直趟:scratch → dst
  blurPass(scratch, dst, w, h, kernel, r, false);

  // alpha 沿用原圖(底圖不透明;此 POC 不處理透明邊界外溢)。
  for (let i = 3; i < src.length; i += 4) dst[i] = src[i];
}

function buildGaussianKernel(r: number, sigma: number): Float32Array {
  const size = 2 * r + 1;
  const k = new Float32Array(size);
  const s2 = 2 * sigma * sigma;
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / s2);
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

function blurPass(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  kernel: Float32Array,
  r: number,
  horizontal: boolean,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ar = 0,
        ag = 0,
        ab = 0;
      for (let t = -r; t <= r; t++) {
        // 邊界夾住(clamp-to-edge)。
        let sx = x,
          sy = y;
        if (horizontal) sx = clampIdx(x + t, w);
        else sy = clampIdx(y + t, h);
        const idx = (sy * w + sx) * 4;
        const wgt = kernel[t + r];
        ar += src[idx] * wgt;
        ag += src[idx + 1] * wgt;
        ab += src[idx + 2] * wgt;
      }
      const o = (y * w + x) * 4;
      dst[o] = ar;
      dst[o + 1] = ag;
      dst[o + 2] = ab;
    }
  }
}

function clampIdx(i: number, max: number): number {
  return i < 0 ? 0 : i >= max ? max - 1 : i;
}
