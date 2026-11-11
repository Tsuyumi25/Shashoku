import { describe, expect, it } from 'vitest'
import type { LayerEffect, StrokeEffect } from './types'
import { joinedBelow, strokeOf, withStroke } from './stroke'

const STROKE: LayerEffect = { kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' }

describe('joinedBelow', () => {
  const item = (id: string, effects: LayerEffect[]) => ({ id, effects })
  const white = (extra: Partial<StrokeEffect> = {}): LayerEffect[] => [{ ...STROKE, ...extra }]
  const ids = (map: Map<string, { id: string }[]>, id: string) => map.get(id)?.map((i) => i.id)
  const joined = (items: { id: string; effects: LayerEffect[] }[]) => joinedBelow(items, (i) => i.effects)

  it('keeps a stroke off the letters of every object under it of the same colour', () => {
    const map = joined([item('a', white()), item('b', white()), item('c', white())])
    expect(ids(map, 'a')).toBeUndefined()
    expect(ids(map, 'b')).toEqual(['a'])
    expect(ids(map, 'c')).toEqual(['a', 'b'])
  })

  /** A band over a band of its own colour cannot be seen, whatever the two widths. */
  it('joins strokes of one colour whatever their widths and positions', () => {
    const map = joined([item('a', white({ width: 2 })), item('b', white({ width: 9, position: 'center' }))])
    expect(ids(map, 'b')).toEqual(['a'])
  })

  it('reads one colour however its hex is cased', () => {
    const map = joined([item('a', white({ color: '#FFFFFF' })), item('b', white())])
    expect(ids(map, 'b')).toEqual(['a'])
  })

  it('lets strokes of different colours fight as the tree stacks them', () => {
    const map = joined([item('a', white()), item('b', white({ color: '#ff0000' }))])
    expect(map.size).toBe(0)
  })

  it('lets a pair fight when either one has let go of joining', () => {
    expect(joined([item('a', white({ joins: false })), item('b', white())]).size).toBe(0)
    expect(joined([item('a', white()), item('b', white({ joins: false }))]).size).toBe(0)
  })

  it('leaves out an object whose stroke is turned down to nothing, since it has no band to keep apart', () => {
    const map = joined([item('a', white({ width: 0 })), item('b', white()), item('c', [])])
    expect(map.size).toBe(0)
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
