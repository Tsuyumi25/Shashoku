import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_TEXT_STYLE,
  labelTextCss,
  labelTextStyleFromExportConfig,
  type LabelTextStyle,
} from './labelTextStyle'
import { defaultExportConfig } from '@shared/ssk/schema'

const style = (patch: Partial<LabelTextStyle> = {}): LabelTextStyle => ({
  ...DEFAULT_LABEL_TEXT_STYLE,
  fontSizePx: 20,
  ...patch,
})

describe('labelTextStyleFromExportConfig', () => {
  it('把工程匯出設定解析為標籤文字樣式', () => {
    const config = defaultExportConfig()
    config.font = 'SourceHanSansTC-Regular'
    config.fontSizePx = 32
    config.textDirection = 'vertical'
    config.textColor = '#123456'

    expect(labelTextStyleFromExportConfig(config)).toEqual({
      fontFamily: 'SourceHanSansTC-Regular',
      fontSizePx: 32,
      direction: 'vertical',
      color: '#123456',
    })
  })
})

describe('labelTextCss', () => {
  it('直排走 writing-mode,字級以原圖 px 表示', () => {
    const css = labelTextCss(style({ direction: 'vertical' }))
    expect(css.writingMode).toBe('vertical-rl')
    expect(css.fontSize).toBe('20px')
    expect(css.whiteSpace).toBe('pre')
  })

  it('空字型名退回 sans-serif', () => {
    expect(labelTextCss(style({ fontFamily: '  ' })).fontFamily).toBe('sans-serif')
  })

  it('輸入框暫時為空或非正數時退回預設字級', () => {
    expect(labelTextCss(style({ fontSizePx: Number.NaN })).fontSize).toBe('24px')
    expect(labelTextCss(style({ fontSizePx: 0 })).fontSize).toBe('24px')
  })
})
