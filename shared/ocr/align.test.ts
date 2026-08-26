import { describe, expect, it } from 'vitest'
import { costGrid } from './align'
import { editDistance } from './similar'

const of = (text: string) => [...text]

function cost(a: string, b: string): number {
  return costGrid(of(a), of(b))[of(a).length][of(b).length]
}

describe('costGrid', () => {
  it('costs nothing to turn a run into itself', () => {
    expect(cost('ふん', 'ふん')).toBe(0)
  })

  it('costs one for a substituted character', () => {
    expect(cost('ふんっ', 'ふんつ')).toBe(1)
  })

  it('costs one for a dropped character', () => {
    expect(cost('ふんっ', 'ふん')).toBe(1)
  })

  it('costs the whole of one run against an empty one', () => {
    expect(cost('ふんっ', '')).toBe(3)
    expect(cost('', 'ふんっ')).toBe(3)
  })

  /**
   * ⭐ The one thing the two callers must not drift apart on. Each walks the
   * table back its own way for its own reasons, but both are walking a path of
   * the minimum this measures — the same minimum a pair of readings is held to
   * be one claim by.
   */
  it('ends on the distance the same pair is compared by', () => {
    for (const [a, b] of [
      ['オーイまてー', 'オイまてー'],
      ['何を言ってるの', '何を言つてるの'],
      ['すき♥', 'すき'],
    ]) {
      expect(cost(a, b)).toBe(editDistance(a, b))
    }
  })
})
