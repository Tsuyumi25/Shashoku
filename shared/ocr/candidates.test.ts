import { describe, expect, it } from 'vitest'
import type { OcrCandidatePersisted, SourceBody } from '../page/types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { emptyBody } from '../page/schema'
import { candidatesFor } from './candidates'

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

const source = (over: Partial<SourceBody> = {}): SourceBody => ({
  ...emptyBody(DEFAULT_TEXT_STYLE),
  by: 'auto',
  lines: [''],
  ...over,
})
const object = (over: Partial<SourceBody> = {}) => ({ source: source(over) })

/** The middle of the balloon every `read()` above was taken from. */
const INSIDE = { x: 200, y: 300 }

const offered = (rows: ReturnType<typeof candidatesFor>) =>
  rows.filter((r) => r.hash !== 'own').map((r) => r.hash)

describe('candidatesFor', () => {
  it('always offers the object’s own row, first', () => {
    const rows = candidatesFor(object(), INSIDE, [])
    expect(rows).toHaveLength(1)
    expect(rows[0].hash).toBe('own')
  })

  it('offers everything read where the object stands', () => {
    const pool = [read({ hash: 'a' }), read({ hash: 'b', source: 'baberu-ocr' })]
    expect(offered(candidatesFor(object(), INSIDE, pool)).sort()).toEqual(['a', 'b'])
  })

  it('offers nothing read somewhere else on the page', () => {
    const pool = [read({ hash: 'far', x: 3000, y: 3000 })]
    expect(offered(candidatesFor(object(), INSIDE, pool))).toEqual([])
  })

  /** ⭐ The list is the place's, so a neighbouring balloon is a different list. */
  it('offers only the place the object stands in, not the one beside it', () => {
    const pool = [
      read({ hash: 'here', x: 100, y: 100, w: 200, h: 200 }),
      read({ hash: 'next-door', x: 400, y: 100, w: 200, h: 200 }),
    ]
    expect(offered(candidatesFor(object(), { x: 200, y: 200 }, pool))).toEqual(['here'])
  })

  it('puts the claim more readers agreed on above a lonelier one', () => {
    const pool = [
      read({ hash: 'lonely', source: 'hayai-ocr-v2', text: 'ちがう', confidence: 0.99 }),
      read({ hash: 'agreed-a', source: 'manga-ocr', text: 'ふん', confidence: 0.8 }),
      read({ hash: 'agreed-b', source: 'baberu-ocr', text: 'ふん', confidence: 0.8 }),
    ]
    expect(offered(candidatesFor(object(), INSIDE, pool))[0]).not.toBe('lonely')
  })

  it('marks the row the object stands for and stands it right after its own', () => {
    const pool = [read({ hash: 'a' }), read({ hash: 'b', source: 'baberu-ocr' })]
    const rows = candidatesFor(object({ from: 'b', by: 'human' }), INSIDE, pool)
    expect(rows[1]).toMatchObject({ hash: 'b', held: true })
    expect(rows.filter((r) => r.held)).toHaveLength(1)
  })

  it('does not offer the held row twice', () => {
    const pool = [read({ hash: 'a' }), read({ hash: 'b', source: 'baberu-ocr' })]
    const rows = candidatesFor(object({ from: 'b', by: 'human' }), INSIDE, pool)
    expect(rows.filter((r) => r.hash === 'b')).toHaveLength(1)
  })

  /**
   * ⚠️ An object carried across the page still stands for what somebody said it
   * stands for. Dropping the row would report the choice as unmade.
   */
  it('keeps showing a held reading taken from somewhere else entirely', () => {
    const pool = [read({ hash: 'far', x: 3000, y: 3000 })]
    const rows = candidatesFor(object({ from: 'far', by: 'human' }), INSIDE, pool)
    expect(rows[1]).toMatchObject({ hash: 'far', held: true })
  })

  it('marks the own row when that is what the object stands for', () => {
    const rows = candidatesFor(object({ by: 'human', lines: ['自分で'] }), INSIDE, [read()])
    expect(rows[0]).toMatchObject({ hash: 'own', text: '自分で', held: true })
  })

  it('says how far each row was read from, for the canvas to draw', () => {
    const rows = candidatesFor(object(), INSIDE, [read({ hash: 'a' })])
    expect(rows[1].distance).toBe(0)
    expect(rows[0].distance).toBeNull()
  })

  it('does not depend on the order the pool is in', () => {
    const pool = [
      read({ hash: 'a', source: 'manga-ocr', text: 'ふん' }),
      read({ hash: 'b', source: 'baberu-ocr', text: 'ふん' }),
      read({ hash: 'c', source: 'hayai-ocr-v2', text: 'ちがう' }),
    ]
    expect(offered(candidatesFor(object(), INSIDE, [...pool].reverse()))).toEqual(
      offered(candidatesFor(object(), INSIDE, pool)),
    )
  })
})
