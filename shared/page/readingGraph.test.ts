import { describe, expect, it } from 'vitest'
import {
  edgesTouching,
  flattenReading,
  hasEdge,
  normalizeEdges,
  readingDepths,
  wouldCycle,
  type ReadingEdge,
  type ReadingRow,
} from './readingGraph'

function edges(...pairs: string[]): ReadingEdge[] {
  return pairs.map((pair) => {
    const [from, to] = pair.split('>')
    return { from, to }
  })
}

function order(ids: string): string[] {
  return ids.split(' ')
}

/** Each row as `id`, `id@lane` while the rail holds it, `id-` once it lets go. */
function rail(rows: readonly ReadingRow[]): string {
  return rows.map((row) => (row.lane === undefined ? `${row.id}-` : `${row.id}@${row.lane}`)).join(' ')
}

function beats(rows: readonly ReadingRow[]): (number | undefined)[] {
  return rows.map((row) => row.depth)
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

describe('flattenReading', () => {
  it('leaves a page with no lines in the order it was typed', () => {
    const rows = flattenReading([], order('a b c'))
    expect(rail(rows)).toBe('a- b- c-')
    expect(beats(rows)).toEqual([undefined, undefined, undefined])
  })

  it('keeps a plain chain in one lane and numbers it from one', () => {
    const rows = flattenReading(edges('a>b', 'b>c'), order('a b c'))
    expect(rail(rows)).toBe('a@0 b@0 c@0')
    expect(beats(rows)).toEqual([1, 2, 3])
  })

  it('puts a branch directly under what it hangs off', () => {
    const rows = flattenReading(edges('a>b', 'b>c', 'a>d'), order('a b c d'))
    expect(rail(rows)).toBe('a@0 d@1 b@0 c@0')
    expect(beats(rows)).toEqual([1, 2, 2, 3])
  })

  it('breaks a tie between two branches on the typing order', () => {
    expect(rail(flattenReading(edges('a>b', 'a>c'), order('a b c')))).toBe('a@0 b@1 c@0')
    expect(rail(flattenReading(edges('a>b', 'a>c'), order('a c b')))).toBe('a@0 c@1 b@0')
  })

  it('gives three branches alive at once three lanes', () => {
    const rows = flattenReading(edges('a>b', 'a>c', 'a>d', 'b>e', 'c>e', 'd>e'), order('a b c d e'))
    expect(rail(rows)).toBe('a@0 b@1 c@2 d@0 e@0')
  })

  it('hands a lane back once its branch ends', () => {
    const rows = flattenReading(edges('a>b', 'a>c', 'c>d', 'c>e'), order('a b c d e'))
    expect(rail(rows)).toBe('a@0 b@1 c@0 d@1 e@0')
  })

  it('holds a meeting point back until every way into it has been laid', () => {
    const rows = flattenReading(edges('a>c', 'b>c', 'c>d'), order('a b c d'))
    expect(rail(rows)).toBe('a@0 b@1 c@0 d@0')
    expect(beats(rows)).toEqual([1, 1, 2, 3])
  })

  /**
   * The shape a page ends on when something joins the last line from the side —
   * it is a start, so its beat is 1 even though it is read near the end.
   */
  it('lands a start that only meets the chain just before the meeting', () => {
    const rows = flattenReading(edges('a>b', 'b>c', 'z>c'), order('a b c z'))
    expect(rail(rows)).toBe('a@0 b@0 z@1 c@0')
    expect(beats(rows)).toEqual([1, 2, 1, 3])
  })

  it('draws the objects a line touches up above the ones it does not', () => {
    const rows = flattenReading(edges('a>b'), order('x a b y'))
    expect(rail(rows)).toBe('a@0 b@0 x- y-')
    expect(beats(rows)).toEqual([1, 2, undefined, undefined])
  })

  it('answers with the objects the page holds, not the ones an edge names', () => {
    expect(rail(flattenReading(edges('a>b', 'b>gone'), order('a b')))).toBe('a@0 b@0')
  })

  it('names what a line arrives from', () => {
    const rows = flattenReading(edges('a>c', 'b>c'), order('a b c'))
    expect(rows.map((row) => row.parents)).toEqual([[], [], ['a', 'b']])
  })

  it('answers the same whichever way the lines were written down', () => {
    const one = flattenReading(edges('c>d', 'a>b', 'a>c', 'b>d'), order('a b c d'))
    const other = flattenReading(edges('b>d', 'a>c', 'c>d', 'a>b'), order('a b c d'))
    expect(one).toEqual(other)
  })

  /**
   * Rings cannot be drawn and repair drops one that arrives anyway. This only
   * says what a broken file looks like: no rail rather than an invented order.
   */
  it('lets a ring fall through to the objects the rail does not hold', () => {
    const rows = flattenReading(edges('b>c', 'c>b'), order('a b c'))
    expect(rail(rows)).toBe('a- b- c-')
  })
})
