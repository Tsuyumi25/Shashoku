import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { SOURCE_COLOR, sourceLook } from './sourceLook'

describe('how a source reads on the canvas', () => {
  const style = { ...DEFAULT_TEXT_STYLE, fontSizePx: 41, direction: 'vertical' as const, color: '#ff0000' }

  it('draws every source in the one colour, over a white halo', () => {
    const look = sourceLook(style)
    expect(look.style.color).toBe(SOURCE_COLOR)
    expect(look.effects).toEqual([{ kind: 'stroke', width: 4, color: '#ffffff', position: 'outside' }])
  })

  /**
   * ⚠️ The half that was measured off the artwork, and a person's to correct.
   * Only the appearance is spoken for here.
   */
  it('leaves everything that was measured off the page alone', () => {
    expect(sourceLook(style).style).toMatchObject({
      fontSizePx: 41,
      direction: 'vertical',
      align: style.align,
      leadingPercent: style.leadingPercent,
    })
  })

  it('does not write through to the style it was handed', () => {
    sourceLook(style)
    expect(style.color).toBe('#ff0000')
  })
})
