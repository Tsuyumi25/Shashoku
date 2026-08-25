import { describe, expect, it } from 'vitest'
import type { TranslationBody, TranslationCandidate } from '@shared/page/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { emptyBody } from '@shared/page/schema'
import {
  OWN,
  offersAChoice,
  planTranslations,
  rowsOf,
  tetherBetween,
  translationCardSize,
  type TranslationList,
} from './translationCards'

const PAGE = { width: 1200, height: 1700 }
const BASE = 12

function body(over: Partial<TranslationBody> = {}): TranslationBody {
  return { ...emptyBody(DEFAULT_TEXT_STYLE), candidates: [], chosen: null, ...over }
}

const candidate = (id: string, text: string, over: Partial<TranslationCandidate> = {}) =>
  ({ id, lines: text.split('\n'), ...over }) as TranslationCandidate

describe('what an object can be read as', () => {
  it('reads an object nobody has proposed for as its own one line', () => {
    expect(rowsOf(body({ lines: ['已經打好的'] }))).toEqual([
      { id: OWN, text: '已經打好的', by: 'own' },
    ])
  })

  it('names the model that proposed a line, and the hand that corrected one', () => {
    const rows = rowsOf(
      body({
        lines: [''],
        candidates: [
          candidate('m', '模型說的', { source: 'claude' }),
          candidate('h', '我改的', { human: true }),
        ],
      }),
    )
    expect(rows.map((r) => [r.by, r.source])).toEqual([
      ['own', undefined],
      ['model', 'claude'],
      ['human', undefined],
    ])
  })

  /**
   * ⚠️ Where deleting the picked proposal drops the object back to. A row that
   * vanished the moment something was picked would make that fall look like the
   * words appearing out of nowhere.
   */
  it('keeps the line the object typed while a proposal is picked', () => {
    const rows = rowsOf(
      body({ lines: ['自己打的'], candidates: [candidate('m', '模型的')], chosen: 'm' }),
    )
    expect(rows.map((r) => r.id)).toEqual([OWN, 'm'])
  })

  /** With nothing typed and nothing picked it is still the row being read. */
  it('keeps an empty own line while it is the one being read', () => {
    expect(rowsOf(body({ lines: [''] })).map((r) => r.id)).toEqual([OWN])
  })

  /** Empty and not being read, it is a row saying nothing about nothing. */
  it('drops an empty own line once a proposal is picked', () => {
    const rows = rowsOf(body({ lines: [''], candidates: [candidate('m', '模型的')], chosen: 'm' }))
    expect(rows.map((r) => r.id)).toEqual(['m'])
  })
})

/**
 * ⭐ The rule the whole card hangs on. One row is not a choice — the object
 * already reads as it, and typing into the object types into that very row.
 */
describe('when a list is worth drawing', () => {
  it('draws nothing for an object with one way to read it', () => {
    expect(offersAChoice(rowsOf(body({ lines: ['一句話'] })))).toBe(false)
  })

  it('draws a list the moment a second way to read it turns up', () => {
    const rows = rowsOf(body({ lines: ['一句話'], candidates: [candidate('m', '另一句')] }))
    expect(offersAChoice(rows)).toBe(true)
  })

  /** The picked one is counted, so a proposal against an empty object is a pair. */
  it('counts the row being read among the two', () => {
    const rows = rowsOf(
      body({ lines: ['自己打的'], candidates: [candidate('m', '模型的')], chosen: 'm' }),
    )
    expect(rows).toHaveLength(2)
    expect(offersAChoice(rows)).toBe(true)
  })

  /** A proposal picked into an object that had nothing typed is one row, not two. */
  it('draws nothing where the only proposal replaced an empty line', () => {
    const rows = rowsOf(body({ lines: [''], candidates: [candidate('m', '模型的')], chosen: 'm' }))
    expect(offersAChoice(rows)).toBe(false)
  })
})

describe('standing the lists in the margin', () => {
  const list = (objectId: string, from: { x: number; y: number }): TranslationList => ({
    objectId,
    rows: [
      { id: OWN, text: '自己打的', by: 'own' },
      { id: 'm', text: '模型的', by: 'model' },
    ],
    chosen: OWN,
    from: { ...from, w: 120, h: 80 },
  })

  const overlapping = (cards: readonly { x: number; y: number; w: number; h: number }[]) =>
    cards.filter((a, i) =>
      cards.some(
        (b, j) =>
          i !== j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
      ),
    )

  it('puts every list off the page', () => {
    const cards = planTranslations([list('a', { x: 900, y: 200 }), list('b', { x: 100, y: 1400 })], BASE, PAGE)
    for (const card of cards) {
      const clear =
        card.x + card.w <= 0 || card.x >= PAGE.width || card.y + card.h <= 0 || card.y >= PAGE.height
      expect(clear).toBe(true)
    }
  })

  /** Which list belongs to which object is said by a line, so the line is kept short. */
  it('leaves a list on the side of the page its object is nearest', () => {
    const [right] = planTranslations([list('a', { x: 1050, y: 800 })], BASE, PAGE)
    expect(right.x).toBeGreaterThanOrEqual(PAGE.width)
    const [left] = planTranslations([list('b', { x: 20, y: 800 })], BASE, PAGE)
    expect(left.x + left.w).toBeLessThanOrEqual(0)
  })

  it('never lets two lists share a spot', () => {
    const lists = Array.from({ length: 8 }, (_, i) => list(`o${i}`, { x: 1000, y: 100 + i * 30 }))
    expect(overlapping(planTranslations(lists, BASE, PAGE))).toEqual([])
  })

  /**
   * ⭐ What keeps a list a reader has already found where they found it: the one
   * arriving late gives way, never the one already standing.
   */
  it('takes the next nearest spot when the nearest one is already standing', () => {
    const alone = planTranslations([list('a', { x: 1050, y: 800 })], BASE, PAGE)[0]
    const beside = planTranslations([list('b', { x: 1050, y: 800 })], BASE, PAGE, [alone])[0]
    expect(beside).not.toEqual(alone)
    expect(
      alone.x < beside.x + beside.w &&
        beside.x < alone.x + alone.w &&
        alone.y < beside.y + beside.h &&
        beside.y < alone.y + alone.h,
    ).toBe(false)
  })

  it('plans the same page the same way twice, whatever order the objects arrive in', () => {
    const lists = [list('a', { x: 900, y: 1200 }), list('b', { x: 200, y: 300 })]
    const byKey = (cards: ReturnType<typeof planTranslations>) =>
      [...cards].sort((p, q) => p.key.localeCompare(q.key)).map((c) => [c.key, c.x, c.y])
    expect(byKey(planTranslations(lists, BASE, PAGE))).toEqual(
      byKey(planTranslations([...lists].reverse(), BASE, PAGE)),
    )
  })

  it('sizes a list against the lines it holds', () => {
    const one = translationCardSize([{ id: OWN, text: '短', by: 'own' }], BASE)
    const many = translationCardSize(
      [
        { id: OWN, text: '短', by: 'own' },
        { id: 'a', text: '另一句比較長的話', by: 'model' },
      ],
      BASE,
    )
    expect(many.h).toBeGreaterThan(one.h)
    expect(many.w).toBeGreaterThan(one.w)
  })
})

/**
 * A line between the middles would start inside the card and cross it; between
 * the facing edges it only ever covers the gap it has to.
 */
describe('the line back to the object', () => {
  it('leaves each box at the edge that faces the other', () => {
    const from = { x: 1000, y: 800, w: 100, h: 60 }
    const card = { x: 1300, y: 800, w: 200, h: 100 }
    const { a, b } = tetherBetween(from, card)
    expect(a.x).toBeCloseTo(1100, 6)
    expect(b.x).toBeCloseTo(1300, 6)
  })

  it('has nowhere to go between two boxes on the same spot, and says so quietly', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 }
    expect(tetherBetween(box, box)).toEqual({ a: { x: 50, y: 50 }, b: { x: 50, y: 50 } })
  })
})
