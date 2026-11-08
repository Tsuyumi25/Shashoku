import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import type { LayerEffect } from '@shared/effects/types'
import { bucketsByAttribute, valueOf, type ShelfObject } from './shelfAttributes'

const obj = (id: string, style: Partial<TextStyle>, effects: LayerEffect[] = [], tags: string[] = []): ShelfObject => ({
  id,
  style: { ...DEFAULT_TEXT_STYLE, ...style },
  effects,
  tags,
})
const tagged = (id: string, ...tags: string[]) => obj(id, {}, [], tags)

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

  it('puts an object in the heap of each of its tags, the untagged last', () => {
    const buckets = bucketsByAttribute(
      [tagged('a', 'x', 'y'), tagged('b', 'y'), tagged('c'), tagged('d'), tagged('e'), tagged('f', 'x')],
      'tag',
      [{ name: 'x', color: '#123456' }],
    )
    expect(buckets.map((b) => [b.label, b.ids, b.swatch])).toEqual([
      ['x', ['a', 'f'], '#123456'],
      ['y', ['a', 'b'], undefined],
      ['沒有標籤', ['c', 'd', 'e'], undefined],
    ])
  })

  it('gathers a set of tags once whatever order they were given in', () => {
    const buckets = bucketsByAttribute(
      [tagged('a', 'y', 'x'), tagged('b', 'x', 'y'), tagged('c', 'x')],
      'tagSet',
      [{ name: 'y', color: '#123456' }, { name: 'x', color: '#654321' }],
    )
    expect(buckets.map((b) => [b.label, b.ids])).toEqual([
      ['y＋x', ['a', 'b']],
      ['x', ['c']],
    ])
  })
})
