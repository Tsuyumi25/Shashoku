import { describe, expect, it } from 'vitest'
import { insertionIndexAt } from './shelfDrop'
import type { CardBox } from './shelfMarquee'

/** A 3-column grid of 100×50 cards, two rows, reading left to right then wrapping. */
function grid(keys: string[], cols = 3, w = 100, h = 50): CardBox[] {
  return keys.map((key, i) => ({
    key,
    box: { x: (i % cols) * w, y: Math.floor(i / cols) * h, w, h },
  }))
}

describe('insertionIndexAt', () => {
  it('lands at the front when the point is above every card', () => {
    const cards = grid(['a', 'b', 'c'])
    expect(insertionIndexAt(cards, { x: 10, y: -5 })).toBe(0)
  })

  it('lands at the end when the point is past every card', () => {
    const cards = grid(['a', 'b', 'c'])
    expect(insertionIndexAt(cards, { x: 10, y: 500 })).toBe(3)
  })

  it('lands before a card when the point sits in its left half', () => {
    const cards = grid(['a', 'b', 'c'])
    expect(insertionIndexAt(cards, { x: 110, y: 10 })).toBe(1)
  })

  it('lands after a card when the point sits in its right half', () => {
    const cards = grid(['a', 'b', 'c'])
    expect(insertionIndexAt(cards, { x: 180, y: 10 })).toBe(2)
  })

  it('crosses a row wrap: past the last card of a row lands before the first of the next', () => {
    const cards = grid(['a', 'b', 'c', 'd', 'e'])
    // x = 290 is past the midpoint of the third card ('c'), still in row 0.
    expect(insertionIndexAt(cards, { x: 290, y: 10 })).toBe(3)
  })

  it('reads a point in row two against row two only', () => {
    const cards = grid(['a', 'b', 'c', 'd', 'e'])
    expect(insertionIndexAt(cards, { x: 10, y: 60 })).toBe(3)
    expect(insertionIndexAt(cards, { x: 110, y: 60 })).toBe(4)
  })

  it('has nowhere to land in an empty grid but the start', () => {
    expect(insertionIndexAt([], { x: 0, y: 0 })).toBe(0)
  })
})
