import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { engineStrokeFor } from './textStyle'

const style: TextStyle = { ...DEFAULT_TEXT_STYLE, fontFamily: 'Default Face' }

describe('engineStrokeFor', () => {
  it('is undefined when the style carries no stroke', () => {
    expect(engineStrokeFor(style)).toBeUndefined()
  })

  it('hands the stroke to the engine in document pixels, unscaled', () => {
    const stroke = engineStrokeFor({
      ...style,
      effects: [{ kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' }],
    })
    expect(stroke).toEqual({ width: 3, color: '#ffffff', position: 'outside' })
  })
})
