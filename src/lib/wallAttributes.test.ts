import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import type { LayerEffect } from '@shared/effects/types'
import { groupByAttribute, valueOf, type WallObject } from './wallAttributes'

const obj = (id: string, style: Partial<TextStyle>, tags: string[] = [], effects: LayerEffect[] = []): WallObject => ({
  id,
  tags,
  style: { ...DEFAULT_TEXT_STYLE, ...style },
  effects,
})

describe('groupByAttribute', () => {
  it('names one value per bucket, biggest first, and keeps meanings apart', () => {
    const groups = groupByAttribute(
      [
        obj('a', { fontFamily: 'A', fontStyleName: 'M' }),
        obj('b', { fontFamily: 'A', fontStyleName: 'M' }),
        obj('c', { fontFamily: 'B', fontStyleName: 'R' }),
        obj('d', { fontFamily: 'A', fontStyleName: 'M' }, ['心聲']),
      ],
      'font',
      [{ name: '心聲', color: '#000' }] as never,
    )
    expect(groups.map((g) => g.tags)).toEqual([['心聲'], []])
    expect(groups[1]!.buckets.map((b) => [b.label, b.ids])).toEqual([
      ['A M', ['a', 'b']],
      ['B R', ['c']],
    ])
  })

  it('tells a face apart by its weight, since the picker sets them together', () => {
    const groups = groupByAttribute(
      [obj('a', { fontFamily: 'A', fontStyleName: 'M' }), obj('b', { fontFamily: 'A', fontStyleName: 'B' })],
      'font',
      [],
    )
    expect(groups[0]!.buckets).toHaveLength(2)
  })

  it('runs amounts smallest first however many lines each holds', () => {
    const groups = groupByAttribute(
      [obj('a', { fontSizePx: 70 }), obj('b', { fontSizePx: 70 }), obj('c', { fontSizePx: 63 }), obj('d', { fontSizePx: 56 })],
      'size',
      [],
    )
    expect(groups[0]!.buckets.map((b) => b.ids)).toEqual([['d'], ['c'], ['a', 'b']])
  })
})

describe('valueOf', () => {
  it('gathers sizes within a tenth into one band and keeps distant ones out', () => {
    const at = (fontSizePx: number) => valueOf(obj('x', { fontSizePx }), 'size').key
    expect(at(55)).toBe(at(59))
    expect(at(47)).not.toBe(at(70))
  })

  it('reads the stroke from the effects', () => {
    const stroked = obj('x', {}, [], [{ kind: 'stroke', width: 5, color: '#000000', position: 'outside' }] as LayerEffect[])
    expect(valueOf(stroked, 'stroke').label).toBe('#000000 5px')
    expect(valueOf(obj('y', {}), 'stroke').label).toBe('無描邊')
    const resting = obj('z', {}, [], [{ kind: 'stroke', width: 0, color: '#ffffff', position: 'outside' }] as LayerEffect[])
    expect(valueOf(resting, 'stroke').key).toBe('none')
  })
})
