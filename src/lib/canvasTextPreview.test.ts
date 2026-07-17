import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CANVAS_TEXT_PREVIEW_STYLE,
  canvasFont,
  canvasTextPreviewStyleFromExportConfig,
  layoutCanvasText,
  type CanvasTextPreviewStyle,
} from './canvasTextPreview'
import { defaultExportConfig } from '@shared/ssk/schema'

const style = (patch: Partial<CanvasTextPreviewStyle> = {}): CanvasTextPreviewStyle => ({
  ...DEFAULT_CANVAS_TEXT_PREVIEW_STYLE,
  fontSizePx: 20,
  ...patch,
})

describe('canvasFont', () => {
  it('一般字型名加引號，generic family 不加', () => {
    expect(canvasFont(style({ fontFamily: 'Source Han Sans TC' }))).toBe(
      '20px "Source Han Sans TC"'
    )
    expect(canvasFont(style({ fontFamily: 'sans-serif' }))).toBe('20px sans-serif')
  })

  it('空字型名退回 sans-serif', () => {
    expect(canvasFont(style({ fontFamily: '  ' }))).toBe('20px sans-serif')
  })

  it('輸入框暫時為空或非正數時退回預設字級', () => {
    expect(canvasFont(style({ fontSizePx: Number.NaN }))).toBe('24px sans-serif')
    expect(canvasFont(style({ fontSizePx: 0 }))).toBe('24px sans-serif')
  })
})

describe('canvasTextPreviewStyleFromExportConfig', () => {
  it('把工程匯出設定解析為 Canvas POC 樣式', () => {
    const config = defaultExportConfig()
    config.font = 'SourceHanSansTC-Regular'
    config.fontSizePx = 32
    config.textDirection = 'vertical'
    config.textColor = '#123456'

    expect(canvasTextPreviewStyleFromExportConfig(config)).toEqual({
      fontFamily: 'SourceHanSansTC-Regular',
      fontSizePx: 32,
      direction: 'vertical',
      color: '#123456',
    })
  })
})

describe('layoutCanvasText', () => {
  it('水平文字保留手動換行，整個文字區塊中心對齊 point', () => {
    expect(layoutCanvasText('第一行\n第二行', 100, 200, style())).toEqual([
      { text: '第一行', x: 100, y: 188, textAlign: 'center' },
      { text: '第二行', x: 100, y: 212, textAlign: 'center' },
    ])
  })

  it('直排逐字向下、換行後新欄往左，各欄中心對齊 point', () => {
    expect(layoutCanvasText('甲乙\n丙', 100, 200, style({ direction: 'vertical' }))).toEqual([
      { text: '甲', x: 112, y: 188, textAlign: 'center' },
      { text: '乙', x: 112, y: 212, textAlign: 'center' },
      { text: '丙', x: 88, y: 200, textAlign: 'center' },
    ])
  })

  it('直排以 code point 切字，不拆散 emoji surrogate pair', () => {
    expect(layoutCanvasText('🎵啦', 0, 0, style({ direction: 'vertical' }))).toEqual([
      { text: '🎵', x: 0, y: -12, textAlign: 'center' },
      { text: '啦', x: 0, y: 12, textAlign: 'center' },
    ])
  })

  it('空文字不產生繪製指令', () => {
    expect(layoutCanvasText('', 0, 0, style())).toEqual([])
  })
})
