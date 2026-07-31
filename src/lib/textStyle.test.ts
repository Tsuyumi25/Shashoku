import { describe, expect, it } from 'vitest'
import type { StyleGroup } from '@shared/project/types'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { engineStrokeFor, resolveTextStyle } from './textStyle'

const defaultStyle: TextStyle = { ...DEFAULT_TEXT_STYLE, fontFamily: 'Default Face' }

const groups: StyleGroup[] = [
  {
    id: 'g1',
    name: 'SFX',
    color: '#ff0000',
    style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Group Face', fontSizePx: 40 },
  },
]

describe('resolveTextStyle', () => {
  it('falls back to the project default when the label is in no group', () => {
    const style = resolveTextStyle({ groupId: null }, groups, defaultStyle)
    expect(style.fontFamily).toBe('Default Face')
  })

  it('falls back to the project default when the group no longer exists', () => {
    const style = resolveTextStyle({ groupId: 'deleted' }, groups, defaultStyle)
    expect(style.fontFamily).toBe('Default Face')
  })

  it("layers the label's group over the project default", () => {
    const style = resolveTextStyle({ groupId: 'g1' }, groups, defaultStyle)
    expect(style.fontFamily).toBe('Group Face')
    expect(style.fontSizePx).toBe(40)
  })

  it('lets a label override win over its group', () => {
    const style = resolveTextStyle(
      { groupId: 'g1', styleOverride: { fontSizePx: 12, color: '#0000ff' } },
      groups,
      defaultStyle,
    )
    expect(style.fontFamily).toBe('Group Face')
    expect(style.fontSizePx).toBe(12)
    expect(style.color).toBe('#0000ff')
  })
})

describe('engineStrokeFor', () => {
  it('is undefined when the style carries no stroke', () => {
    expect(engineStrokeFor(defaultStyle)).toBeUndefined()
  })

  it('hands the stroke to the engine in document pixels, unscaled', () => {
    const stroke = engineStrokeFor({
      ...defaultStyle,
      effects: [{ kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' }],
    })
    expect(stroke).toEqual({ width: 3, color: '#ffffff', position: 'outside' })
  })
})
