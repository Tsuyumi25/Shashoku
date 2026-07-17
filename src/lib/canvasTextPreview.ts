import type { LabelItem } from '@/types/project'
import type { SskExportConfig } from '@shared/ssk/types'

export type CanvasTextPreviewDirection = 'horizontal' | 'vertical'

export interface CanvasTextPreviewStyle {
  fontFamily: string
  fontSizePx: number
  direction: CanvasTextPreviewDirection
  color: string
}

export interface CanvasTextRun {
  text: string
  x: number
  y: number
  textAlign: CanvasTextAlign
}

export const DEFAULT_CANVAS_TEXT_PREVIEW_STYLE: CanvasTextPreviewStyle = {
  fontFamily: 'sans-serif',
  fontSizePx: 24,
  direction: 'horizontal',
  color: '#000000',
}

const LINE_HEIGHT_RATIO = 1.2
const GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
])

function validFontSizePx(style: CanvasTextPreviewStyle): number {
  return Number.isFinite(style.fontSizePx) && style.fontSizePx > 0
    ? style.fontSizePx
    : DEFAULT_CANVAS_TEXT_PREVIEW_STYLE.fontSizePx
}

/**
 * Canvas 與工程檔都以原圖 px 表示字級；JSX 端才依 PSD resolution 換算成 pt。
 * 其餘欄位也直接沿用會寫入 JSX 的同一份 exportConfig。
 */
export function canvasTextPreviewStyleFromExportConfig(
  config: SskExportConfig
): CanvasTextPreviewStyle {
  return {
    fontFamily: config.font ?? DEFAULT_CANVAS_TEXT_PREVIEW_STYLE.fontFamily,
    fontSizePx: config.fontSizePx ?? DEFAULT_CANVAS_TEXT_PREVIEW_STYLE.fontSizePx,
    direction: config.textDirection === 'vertical' ? 'vertical' : 'horizontal',
    color: config.textColor,
  }
}

/** Canvas font shorthand：一般字型名加引號，generic family 保留 CSS 關鍵字語義。 */
export function canvasFont(style: CanvasTextPreviewStyle): string {
  const family = style.fontFamily.trim() || DEFAULT_CANVAS_TEXT_PREVIEW_STYLE.fontFamily
  const cssFamily = GENERIC_FONT_FAMILIES.has(family.toLowerCase())
    ? family
    : JSON.stringify(family)
  return `${validFontSizePx(style)}px ${cssFamily}`
}

/**
 * POC 排版規則：point 是整個文字區塊中心；水平文字逐行向下，直排逐字向下、
 * 手動換行產生由右往左的新欄。
 * 下一階段才校準 Photoshop 的基線、標點旋轉與實際 leading。
 */
export function layoutCanvasText(
  text: string,
  anchorX: number,
  anchorY: number,
  style: CanvasTextPreviewStyle
): CanvasTextRun[] {
  if (text === '') return []

  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const lineHeight = validFontSizePx(style) * LINE_HEIGHT_RATIO

  if (style.direction === 'horizontal') {
    return lines
      .map((line, index): CanvasTextRun | null =>
        line === ''
          ? null
          : {
              text: line,
              x: anchorX,
              y: anchorY + (index - (lines.length - 1) / 2) * lineHeight,
              textAlign: 'center',
            }
      )
      .filter((run): run is CanvasTextRun => run !== null)
  }

  const runs: CanvasTextRun[] = []
  for (let column = 0; column < lines.length; column++) {
    const glyphs = Array.from(lines[column])
    for (let row = 0; row < glyphs.length; row++) {
      runs.push({
        text: glyphs[row],
        x: anchorX + ((lines.length - 1) / 2 - column) * lineHeight,
        y: anchorY + (row - (glyphs.length - 1) / 2) * lineHeight,
        textAlign: 'center',
      })
    }
  }
  return runs
}

export function drawCanvasTextPreview(
  context: CanvasRenderingContext2D,
  label: LabelItem,
  canvasWidth: number,
  canvasHeight: number,
  style: CanvasTextPreviewStyle
): void {
  const runs = layoutCanvasText(label.text, label.x * canvasWidth, label.y * canvasHeight, style)
  if (runs.length === 0) return

  context.save()
  context.font = canvasFont(style)
  context.fillStyle = style.color
  context.textBaseline = 'middle'
  for (const run of runs) {
    context.textAlign = run.textAlign
    context.fillText(run.text, run.x, run.y)
  }
  context.restore()
}
