import { describe, expect, it } from 'vitest'
import type { OcrCandidatePersisted } from '../page/types'
import { placesIn } from './places'

let next = 0
const read = (over: Partial<OcrCandidatePersisted> = {}): OcrCandidatePersisted => ({
  hash: `h${(next += 1)}`,
  source: 'manga-ocr',
  text: 'ふん',
  original: 'ふん',
  x: 100,
  y: 100,
  w: 200,
  h: 400,
  confidence: 0.9,
  label: 'text_bubble',
  ...over,
})

/** Every hash in each place, so a test can talk about grouping and nothing else. */
const grouped = (pool: OcrCandidatePersisted[]) =>
  placesIn(pool)
    .map((place) => place.readings.map((r) => r.hash).sort())
    .sort((a, b) => a[0].localeCompare(b[0]))

describe('placesIn', () => {
  it('finds nothing in an empty pool', () => {
    expect(placesIn([])).toEqual([])
  })

  it('puts four readings of one region in one place', () => {
    const pool = [
      read({ hash: 'a', source: 'manga-ocr' }),
      read({ hash: 'b', source: 'ppocr-v6' }),
      read({ hash: 'c', source: 'baberu-ocr' }),
      read({ hash: 'd', source: 'hayai-ocr-v2' }),
    ]
    expect(grouped(pool)).toEqual([['a', 'b', 'c', 'd']])
  })

  it('keeps two balloons at opposite ends of the page apart', () => {
    const pool = [read({ hash: 'a' }), read({ hash: 'b', x: 2000, y: 2000 })]
    expect(grouped(pool)).toEqual([['a'], ['b']])
  })

  it('joins two boxes that cover most of each other', () => {
    const pool = [read({ hash: 'a' }), read({ hash: 'b', x: 110, y: 110 })]
    expect(grouped(pool)).toEqual([['a', 'b']])
  })

  /**
   * ⭐ The reason coverage is asked of both boxes. A page-wide caption clips
   * every balloon it crosses, and "any overlap at all" would string the whole
   * page into one place.
   */
  it('does not let a page-wide caption swallow the balloons it crosses', () => {
    const pool = [
      read({ hash: 'caption', x: 0, y: 200, w: 2000, h: 60 }),
      read({ hash: 'left', x: 100, y: 100, w: 200, h: 400 }),
      read({ hash: 'right', x: 1500, y: 100, w: 200, h: 400 }),
    ]
    expect(grouped(pool)).toEqual([['caption'], ['left'], ['right']])
  })

  /**
   * ⭐ And the reason containment alone will not do. A small balloon sitting
   * wholly inside a big sound effect has the shape of a real nesting and means
   * the opposite of one.
   */
  it('does not join a small balloon that merely sits inside a big effect', () => {
    const pool = [
      read({ hash: 'effect', x: 0, y: 0, w: 1000, h: 1000 }),
      read({ hash: 'balloon', x: 400, y: 400, w: 100, h: 100 }),
    ]
    expect(grouped(pool)).toEqual([['balloon'], ['effect']])
  })

  it('answers the union of the boxes it joined', () => {
    const [place] = placesIn([
      read({ hash: 'a', x: 100, y: 100, w: 200, h: 400 }),
      read({ hash: 'b', x: 120, y: 90, w: 200, h: 400 }),
    ])
    expect(place).toMatchObject({ x: 100, y: 90, w: 220, h: 410 })
  })

  it('joins two readings through a third that overlaps them both', () => {
    const pool = [
      read({ hash: 'a', x: 100, y: 100, w: 200, h: 400 }),
      read({ hash: 'b', x: 130, y: 100, w: 200, h: 400 }),
      read({ hash: 'c', x: 160, y: 100, w: 200, h: 400 }),
    ]
    expect(grouped(pool)).toEqual([['a', 'b', 'c']])
  })

  it('is not moved by the order the pool happens to be in', () => {
    const pool = [
      read({ hash: 'a' }),
      read({ hash: 'b', x: 110, y: 110 }),
      read({ hash: 'c', x: 2000, y: 2000 }),
    ]
    expect(grouped([...pool].reverse())).toEqual(grouped(pool))
  })
})
