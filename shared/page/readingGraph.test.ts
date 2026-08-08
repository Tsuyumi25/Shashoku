import { describe, expect, it } from 'vitest'
import {
  edgesTouching,
  hasEdge,
  normalizeEdges,
  readingDepths,
  wouldCycle,
  type ReadingEdge,
} from './readingGraph'

function edges(...pairs: string[]): ReadingEdge[] {
  return pairs.map((pair) => {
    const [from, to] = pair.split('>')
    return { from, to }
  })
}

describe('normalizeEdges', () => {
  it('drops a repeat of an edge already there', () => {
    expect(normalizeEdges(edges('a>b', 'a>b'))).toEqual(edges('a>b'))
  })

  it('keeps both directions apart', () => {
    expect(normalizeEdges(edges('b>a', 'a>b'))).toEqual(edges('a>b', 'b>a'))
  })

  it('orders two writes of the same graph the same way', () => {
    const one = normalizeEdges(edges('c>d', 'a>b', 'a>c'))
    const other = normalizeEdges(edges('a>c', 'c>d', 'a>b'))
    expect(one).toEqual(other)
  })
})

describe('hasEdge', () => {
  it('is direction-sensitive', () => {
    expect(hasEdge(edges('a>b'), { from: 'a', to: 'b' })).toBe(true)
    expect(hasEdge(edges('a>b'), { from: 'b', to: 'a' })).toBe(false)
  })
})

describe('wouldCycle', () => {
  it('refuses an object pointed at itself', () => {
    expect(wouldCycle([], { from: 'a', to: 'a' })).toBe(true)
  })

  it('refuses the way back along an edge already drawn', () => {
    expect(wouldCycle(edges('a>b'), { from: 'b', to: 'a' })).toBe(true)
  })

  it('refuses the way back along a chain', () => {
    expect(wouldCycle(edges('a>b', 'b>c'), { from: 'c', to: 'a' })).toBe(true)
  })

  it('allows a second edge out of one object', () => {
    expect(wouldCycle(edges('a>b'), { from: 'a', to: 'c' })).toBe(false)
  })

  it('allows two chains to meet', () => {
    expect(wouldCycle(edges('a>c', 'b>d'), { from: 'd', to: 'c' })).toBe(false)
  })

  it('allows an edge that only shortcuts a path already there', () => {
    expect(wouldCycle(edges('a>b', 'b>c'), { from: 'a', to: 'c' })).toBe(false)
  })
})

describe('readingDepths', () => {
  it('numbers a plain chain from one', () => {
    const depths = readingDepths(edges('a>b', 'b>c'))
    expect([...depths]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])
  })

  it('gives objects that split off the same place one number', () => {
    const depths = readingDepths(edges('a>b', 'a>c'))
    expect(depths.get('b')).toBe(2)
    expect(depths.get('c')).toBe(2)
  })

  it('starts a second chain at one as well', () => {
    const depths = readingDepths(edges('a>b', 'c>d'))
    expect(depths.get('a')).toBe(1)
    expect(depths.get('c')).toBe(1)
  })

  it('takes the longest way in, not the first', () => {
    const depths = readingDepths(edges('a>b', 'b>c', 'a>c'))
    expect(depths.get('c')).toBe(3)
  })

  it('numbers where two branches meet again from the longer branch', () => {
    const depths = readingDepths(edges('a>b', 'a>c', 'c>d', 'b>e', 'd>e'))
    expect(depths.get('e')).toBe(4)
  })

  it('leaves an object nothing reaches out of the answer', () => {
    const depths = readingDepths(edges('a>b'))
    expect(depths.has('z')).toBe(false)
  })

  /**
   * A cycle cannot be drawn and repair drops one that arrives anyway, so this
   * only says what happens if either is ever wrong: the ring goes unnumbered,
   * which reads as "nobody maintained this" rather than as a wrong number.
   */
  it('leaves a ring unnumbered rather than guessing', () => {
    const depths = readingDepths(edges('a>b', 'b>a', 'c>d'))
    expect(depths.has('a')).toBe(false)
    expect(depths.has('b')).toBe(false)
    expect(depths.get('c')).toBe(1)
  })
})

describe('edgesTouching', () => {
  it('takes both the ones out of an object and the ones into it', () => {
    const all = edges('a>b', 'b>c', 'c>d')
    expect(edgesTouching(all, new Set(['b']))).toEqual(edges('a>b', 'b>c'))
  })

  it('names an edge between two doomed objects once', () => {
    const all = edges('a>b', 'b>c')
    expect(edgesTouching(all, new Set(['a', 'b']))).toEqual(edges('a>b', 'b>c'))
  })
})
