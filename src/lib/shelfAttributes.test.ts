import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import type { LayerEffect } from '@shared/effects/types'
import { bucketsByAttribute, valueOf, type ShelfObject } from './shelfAttributes'

const obj = (id: string, style: Partial<TextStyle>, effects: LayerEffect[] = []): ShelfObject => ({
  id,
  style: { ...DEFAULT_TEXT_STYLE, ...style },
  effects,
})

describe('valueOf', () => {
  it('gathers sizes within a tenth into one band and keeps distant ones out', () => {
    const at = (fontSizePx: number) => valueOf(obj('x', { fontSizePx }), 'size').key
    expect(at(55)).toBe(at(59))
    expect(at(47)).not.toBe(at(70))
  })

  it('reads the stroke from the effects', () => {
    const stroked = obj('x', {}, [{ kind: 'stroke', width: 5, color: '#000000', position: 'outside' }] as LayerEffect[])
    expect(valueOf(stroked, 'stroke').label).toBe('#000000 5px')
    expect(valueOf(obj('y', {}), 'stroke').label).toBe('無描邊')
    const resting = obj('z', {}, [{ kind: 'stroke', width: 0, color: '#ffffff', position: 'outside' }] as LayerEffect[])
    expect(valueOf(resting, 'stroke').key).toBe('none')
  })
})

describe('bucketsByAttribute', () => {
  it('names one value per bucket, the biggest kind first', () => {
    const buckets = bucketsByAttribute(
      [obj('a', { color: '#ff0000' }), obj('b', { color: '#0000ff' }), obj('c', { color: '#ff0000' })],
      'color',
    )
    expect(buckets.map((b) => [b.label, b.ids])).toEqual([
      ['#ff0000', ['a', 'c']],
      ['#0000ff', ['b']],
    ])
  })

  it('tells a face apart by its weight, since the picker sets them together', () => {
    const buckets = bucketsByAttribute(
      [obj('a', { fontFamily: 'A', fontStyleName: 'M' }), obj('b', { fontFamily: 'A', fontStyleName: 'B' })],
      'font',
    )
    expect(buckets).toHaveLength(2)
  })

  it('runs an amount smallest first however many each holds', () => {
    const buckets = bucketsByAttribute(
      [obj('a', { weightPx: 2 }), obj('b', { weightPx: 2 }), obj('c', { weightPx: 0 })],
      'weight',
    )
    expect(buckets.map((b) => b.label)).toEqual(['0', '2'])
  })
})
