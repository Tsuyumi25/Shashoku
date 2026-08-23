import { describe, expect, it } from 'vitest'
import type { LayerEffect } from './types'
import { engineStrokeFor, strokeOf, withStroke } from './stroke'

const STROKE: LayerEffect = { kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' }

describe('engineStrokeFor', () => {
  it('is undefined when the node carries no stroke', () => {
    expect(engineStrokeFor([])).toBeUndefined()
  })

  it('hands the stroke to the engine in document pixels, unscaled', () => {
    expect(engineStrokeFor([STROKE])).toEqual({
      width: 3,
      color: '#ffffff',
      position: 'outside',
    })
  })
})

describe('withStroke', () => {
  it('replaces the stroke that was there rather than adding a second', () => {
    const next = withStroke([STROKE], { ...STROKE, width: 8 })
    expect(next).toEqual([{ ...STROKE, width: 8 }])
  })

  it('leaves the list without one when the stroke is taken off', () => {
    expect(withStroke([STROKE], null)).toEqual([])
  })

  it('reads back what it wrote', () => {
    expect(strokeOf(withStroke([], STROKE))).toEqual(STROKE)
  })
})
