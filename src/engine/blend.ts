// Blend mode——Tier 2 邊界:只用 Canvas 原生 16 種(W3C Compositing L1,
// globalCompositeOperation 直接支援,零實作成本)。PS 專屬的 11 種(Linear
// Burn/Vivid Light 等)不手刻;真有需求再走 glsl-blend 公式移植那條路。

export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

export type BlendMode = (typeof BLEND_MODES)[number];

/** blend mode → canvas 合成運算子。normal 即 source-over。 */
export function toCompositeOp(mode: BlendMode): GlobalCompositeOperation {
  return mode === "normal" ? "source-over" : mode;
}

/** UI 顯示名(PS 慣用中文譯名,嵌字者的既有語彙)。 */
export const BLEND_MODE_LABELS: Record<BlendMode, string> = {
  normal: "正常",
  multiply: "色彩增值",
  screen: "濾色",
  overlay: "覆蓋",
  darken: "變暗",
  lighten: "變亮",
  "color-dodge": "加亮顏色",
  "color-burn": "加深顏色",
  "hard-light": "實光",
  "soft-light": "柔光",
  difference: "差異化",
  exclusion: "排除",
  hue: "色相",
  saturation: "飽和度",
  color: "顏色",
  luminosity: "明度",
};
