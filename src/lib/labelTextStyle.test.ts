import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LABEL_TEXT_STYLE,
  effectiveStyleForLabel,
  labelTextCss,
  type LabelTextStyle,
} from './labelTextStyle'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { StyleGroup } from '@shared/project/types'

const style = (patch: Partial<LabelTextStyle> = {}): LabelTextStyle => ({
  ...DEFAULT_LABEL_TEXT_STYLE,
  fontSizePx: 20,
  ...patch,
})

const group = (id: string, patch: Partial<StyleGroup['style']> = {}): StyleGroup => ({
  id,
  name: id,
  color: '#000000',
  style: { ...DEFAULT_TEXT_STYLE, ...patch },
})

describe('effectiveStyleForLabel', () => {
  const header = {
    groups: [
      group('grp-a', { fontFamily: 'FontA', fontSizePx: 30 }),
      group('grp-b', { fontFamily: 'FontB' }),
    ],
    defaultStyle: { ...DEFAULT_TEXT_STYLE, fontFamily: 'DefaultFont', color: '#111111' },
  }

  it('無 groupId 時 = defaultStyle', () => {
    expect(effectiveStyleForLabel({ groupId: null }, header)).toEqual(header.defaultStyle)
  })

  it('有 groupId 時 group.style 完整取代 defaultStyle(group.style 是完整 TextStyle)', () => {
    const s = effectiveStyleForLabel({ groupId: 'grp-a' }, header)
    expect(s).toEqual(header.groups[0].style)
    expect(s.fontFamily).toBe('FontA')
    expect(s.fontSizePx).toBe(30)
    // group.style 是完整物件,defaultStyle 完全被覆蓋
    expect(s.color).toBe(DEFAULT_TEXT_STYLE.color)
  })

  it('styleOverride 是最高優先(diff:只覆寫列出的欄位)', () => {
    const s = effectiveStyleForLabel(
      { groupId: 'grp-a', styleOverride: { color: '#ff0000' } },
      header,
    )
    expect(s.color).toBe('#ff0000')
    expect(s.fontFamily).toBe('FontA') // group 層仍生效
    expect(s.fontSizePx).toBe(30)
  })

  it('groupId 指向已刪除的 group 時視同無 groupId(容錯)', () => {
    const s = effectiveStyleForLabel({ groupId: 'grp-ghost' }, header)
    expect(s).toEqual(header.defaultStyle)
  })

  it('空 styleOverride 物件視同無 override', () => {
    const s = effectiveStyleForLabel({ groupId: null, styleOverride: {} }, header)
    expect(s).toEqual(header.defaultStyle)
  })
})

describe('labelTextCss', () => {
  it('直排走 writing-mode,字級以原圖 px 表示', () => {
    const css = labelTextCss(style({ direction: 'vertical' }))
    expect(css.writingMode).toBe('vertical-rl')
    expect(css.fontSize).toBe('20px')
    expect(css.whiteSpace).toBe('pre')
  })

  it('空字型名退回 sans-serif(用單引號 quote,含特殊字元的匯入字型也 work)', () => {
    expect(labelTextCss(style({ fontFamily: '  ' })).fontFamily).toBe("'sans-serif'")
  })

  it('字型名含 [] 特殊字元也被 quote(匯入字型)', () => {
    expect(labelTextCss(style({ fontFamily: '[工具箱]拙黑体-简体' })).fontFamily).toBe(
      "'[工具箱]拙黑体-简体'",
    )
  })

  it('字型名內的單引號被剝除(避免 CSS 注入)', () => {
    expect(labelTextCss(style({ fontFamily: "a'b" })).fontFamily).toBe("'ab'")
  })

  it('輸入框暫時為空或非正數時退回預設字級', () => {
    expect(labelTextCss(style({ fontSizePx: Number.NaN })).fontSize).toBe('24px')
    expect(labelTextCss(style({ fontSizePx: 0 })).fontSize).toBe('24px')
  })

  it('lineHeight 由 leadingPercent 動態決定(百分比 → CSS 純數字)', () => {
    expect(labelTextCss(style({ leadingPercent: 150 })).lineHeight).toBe('1.5')
    expect(labelTextCss(style({ leadingPercent: 100 })).lineHeight).toBe('1')
  })

  it('非正 leadingPercent 退回 DEFAULT_TEXT_STYLE.leadingPercent', () => {
    expect(labelTextCss(style({ leadingPercent: 0 })).lineHeight).toBe(
      String(DEFAULT_TEXT_STYLE.leadingPercent / 100),
    )
    expect(labelTextCss(style({ leadingPercent: Number.NaN })).lineHeight).toBe(
      String(DEFAULT_TEXT_STYLE.leadingPercent / 100),
    )
  })
})
