import { PASS_THROUGH } from '@shared/page/types'

/** Names as Photoshop's 繁體中文 build has them, so the vocabulary carries over. */
export const BLEND_LABELS: Record<string, string> = {
  [PASS_THROUGH]: '穿透',
  normal: '正常',
  multiply: '色彩增值',
  screen: '濾色',
  overlay: '覆蓋',
  darken: '變暗',
  lighten: '變亮',
  'color-dodge': '加亮顏色',
  'color-burn': '加深顏色',
  'hard-light': '實光',
  'soft-light': '柔光',
  difference: '差異化',
  exclusion: '排除',
  hue: '色相',
  saturation: '飽和度',
  color: '顏色',
  luminosity: '明度',
}
