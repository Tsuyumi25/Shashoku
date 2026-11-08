import { describe, expect, it } from 'vitest'
import type { Obb } from '@/lib/selection/obb'
import { stampedBlocks } from './tagStamps'

const at = (x: number, y: number, w = 10, h = 10, rotation = 0): Obb => ({
  center: { x: x + w / 2, y: y + h / 2 },
  w,
  h,
  rotation,
})

describe('stampedBlocks', () => {
  it('gives a chain of touching blocks one stamp, on the one furthest up and left', () => {
    const frames = new Map([
      ['a', at(18, 0)],
      ['b', at(9, 2)],
      ['c', at(0, 4)],
    ])
    expect(stampedBlocks([['a', 'b', 'c']], frames)).toEqual(new Set(['c']))
  })

  it('stamps each piece of a sentence that stands apart, and ignores other sentences', () => {
    const frames = new Map([
      ['a1', at(0, 0)],
      ['a2', at(100, 0)],
      ['b', at(5, 5)],
    ])
    expect(stampedBlocks([['a1', 'a2'], ['b']], frames)).toEqual(new Set(['a1', 'a2', 'b']))
  })

  it('takes a turned frame by where it is, not by its upright bounds', () => {
    const long = at(0, 0, 100, 4, Math.PI / 4)
    // Inside the upright bounds of the turned bar, well off the bar itself.
    const nearCorner = at(70, 0, 6, 6)
    expect(stampedBlocks([['bar', 'box']], new Map([['bar', long], ['box', nearCorner]]))).toEqual(
      new Set(['bar', 'box']),
    )
  })

  it('stamps a block that belongs to no sentence', () => {
    expect(stampedBlocks([], new Map([['x', at(0, 0)]]))).toEqual(new Set(['x']))
  })
})
