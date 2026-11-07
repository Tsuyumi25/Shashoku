import { describe, expect, it } from 'vitest'
import type { OcrCandidatePersisted } from '@shared/page/types'
import type { Box } from '@shared/ocr/places'
import {
  cardSize,
  layoutCards,
  outsideCards,
  textsOf,
  type Explosion,
  type Listed,
} from '@/lib/sourceCards'

const PAGE = { width: 1200, height: 1700 }
const BASE = 12

let next = 0
const read = (text: string): OcrCandidatePersisted => ({
  hash: `h${(next += 1)}`,
  source: 'manga-ocr',
  text,
  original: text,
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  confidence: 0.9,
  label: 'text_bubble',
})

/** A place with everything it ever offered still on it. */
function listed(box: Box, texts: string[]): Listed {
  const full = texts.map(read)
  return { ...box, full, readings: full }
}

const overlaps = (a: Box, b: Box): boolean =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y)

describe('cardSize', () => {
  it('grows with the number of rows', () => {
    const one = cardSize(['ふん'], BASE)
    const two = cardSize(['ふん', 'そうかい'], BASE)
    expect(two.h).toBeGreaterThan(one.h)
  })

  /**
   * ⭐ A reading arrives already broken where the run measured the balloon's
   * columns, and the card keeps those breaks — so a two-line reading is two
   * lines tall.
   */
  it('counts a reading’s own line breaks', () => {
    expect(cardSize(['ふんそうかい'], BASE).h).toBeLessThan(
      cardSize(['ふん\nそうかい'], BASE).h,
    )
  })

  it('widens for a longer line, up to a bound', () => {
    const short = cardSize(['ふん'], BASE)
    const longer = cardSize(['ふんそうかいね'], BASE)
    const absurd = cardSize(['あ'.repeat(200)], BASE)
    expect(longer.w).toBeGreaterThan(short.w)
    expect(absurd.w).toBeLessThan(short.w * 4)
  })

  it('gives a reading that says nothing a row of its own anyway', () => {
    expect(cardSize([''], BASE).h).toBeGreaterThan(0)
  })
})

describe('layoutCards', () => {
  const place = (x: number, y: number): Box => ({ x, y, w: 120, h: 90 })
  const plan = (lists: Listed[], boxes: Box[], options = {}) =>
    layoutCards(lists, boxes, BASE, PAGE, options).plans
  const onPage = (b: Box) => b.x >= 0 && b.y >= 0 && b.x + b.w <= PAGE.width && b.y + b.h <= PAGE.height

  it('stands a card beside the place it came off', () => {
    const one = place(400, 500)
    const [card] = plan([listed(one, ['ふん'])], [one])
    expect(overlaps(card, one)).toBe(false)
    expect(card.from).toEqual(one)
  })

  it('covers neither a place nor an object', () => {
    const mine = place(400, 500)
    const neighbour = place(560, 500)
    const object: Box = { x: 400, y: 620, w: 140, h: 60 }
    const [card] = plan([listed(mine, ['ふん'])], [mine, neighbour, object])
    expect(overlaps(card, mine)).toBe(false)
    expect(overlaps(card, neighbour)).toBe(false)
    expect(overlaps(card, object)).toBe(false)
  })

  it('keeps two cards off each other', () => {
    const a = place(300, 300)
    const b = place(300, 400)
    const cards = plan([listed(a, ['ふん']), listed(b, ['そうかい'])], [a, b])
    expect(cards).toHaveLength(2)
    expect(overlaps(cards[0], cards[1])).toBe(false)
  })

  /**
   * ⭐ A card touching its own balloon and a stranger's is a card nobody can
   * attribute; with a free side away from the stranger, that side is taken.
   */
  it('stands on the side away from a neighbouring place when that side is free', () => {
    const mine = place(500, 700)
    const stranger = place(500 + 120 + 100, 700)
    const [card] = plan([listed(mine, ['ふん'])], [mine, stranger])
    expect(card.x + card.w).toBeLessThanOrEqual(mine.x)
  })

  /**
   * ⭐ A card somewhere awkward can be dragged; a card that was never drawn
   * cannot be found. So a place with nowhere clear still gets its card.
   */
  it('places every card even when nothing near its place is clear', () => {
    const middle = place(500, 700)
    const wall: Box = { x: middle.x - 300, y: middle.y - 300, w: 720, h: 690 }
    const ring = [
      { ...wall, h: 290 },
      { ...wall, y: middle.y + middle.h + 10, h: 290 },
      { ...wall, w: 290, y: middle.y, h: middle.h },
      { ...wall, x: middle.x + middle.w + 10, w: 290, y: middle.y, h: middle.h },
    ]
    const cards = plan([listed(middle, ['ふん'])], [middle, ...ring])
    expect(cards).toHaveLength(1)
  })

  /**
   * ⭐ The cards that have room keep it. Only the ones that found none stand
   * outside, rather than the whole page going out together.
   */
  it('sends out only the cards with no room, and keeps the rest on the page', () => {
    const packed: Box[] = []
    for (let y = 0; y < PAGE.height; y += 100) for (let x = 0; x < 500; x += 100) packed.push({ x, y, w: 95, h: 95 })
    const alone = place(900, 800)
    const boxes = [...packed, alone]
    const cards = plan(
      boxes.map((b, i) => listed(b, [`ふん${i}`])),
      boxes,
    )
    const own = cards.find((c) => c.from.x === alone.x && c.from.y === alone.y)!
    expect(onPage(own)).toBe(true)
    expect(cards.some((c) => !onPage(c))).toBe(true)
  })

  it('does not treat a box covering much of the page as an obstacle', () => {
    const one = place(500, 700)
    const huge: Box = { x: 0, y: 0, w: PAGE.width, h: PAGE.height }
    const [card] = plan([listed(one, ['ふん'])], [one, huge])
    expect(overlaps(card, huge)).toBe(true)
  })

  it('keeps a card on the page rather than hanging it off the edge', () => {
    const edge: Box = { x: 1050, y: 500, w: 120, h: 90 }
    const [card] = plan([listed(edge, ['ふん'])], [edge])
    expect(onPage(card)).toBe(true)
  })

  /** ⭐ The order the pool happens to be in is not something a reader can see. */
  it('lays out the same page the same way twice, whatever order it is handed', () => {
    const boxes = [place(300, 900), place(700, 200), place(200, 500)]
    const lists = boxes.map((b, i) => listed(b, [`ふん${i}`]))
    expect(plan([...lists].reverse(), boxes)).toEqual(plan(lists, boxes))
  })

  /**
   * ⭐ What makes working through a list a row at a time possible: the row
   * under the pointer stays under the pointer.
   */
  it('leaves a card exactly where it was when a row is taken out of it', () => {
    const one = place(400, 500)
    const full = ['ふん', 'そうかい', 'ふう'].map(read)
    const [before] = plan([{ ...one, full, readings: full }], [one])
    const [after] = plan([{ ...one, full, readings: full.slice(1) }], [one])
    expect([after.x, after.y, after.w, after.h]).toEqual([before.x, before.y, before.w, before.h])
  })

  /** ⭐ Starting from where the cards stood, a page nobody changed does not move. */
  it('starting from its own last answer, gives the same answer', () => {
    const boxes = [place(300, 300), place(300, 420), place(460, 360), place(900, 1200)]
    const lists = boxes.map((b, i) => listed(b, [`ふん${i}`, `ふう${i}`]))
    const first = layoutCards(lists, boxes, BASE, PAGE)
    const again = layoutCards(lists, boxes, BASE, PAGE, { previous: first.picks })
    expect(again.plans).toEqual(first.plans)
  })

  describe('on a page in pieces', () => {
    // The page cut down the middle and each half pushed 100 px outward, which
    // opens a 200 px gap between x = 500 and x = 700 where the page is shown.
    const travel = (box: Box) => ({ x: box.x + box.w / 2 < 600 ? -100 : 100, y: 0 })
    const explosion: Explosion = {
      shiftOf: travel,
      pieces: [
        { x: -100, y: 0, w: 600, h: PAGE.height },
        { x: 700, y: 0, w: 600, h: PAGE.height },
      ],
    }
    const shown = (card: Box, from: Box): Box => ({ ...card, x: card.x + travel(from).x })

    it('answers in page pixels, so the card travels with its place', () => {
      const one = place(200, 700)
      const [card] = plan([listed(one, ['ふん'])], [one], { explosion })
      expect(overlaps(shown(card, one), { ...one, x: one.x - 100 })).toBe(false)
      expect(overlaps(card, one)).toBe(false)
    })

    /** ⭐ The gap is nobody's artwork, so a card beside it stands in it. */
    it('stands a card in the gap rather than on the artwork', () => {
      const edge: Box = { x: 600, y: 700, w: 120, h: 90 }
      const [card] = plan([listed(edge, ['ふん'])], [edge], { explosion })
      const at = shown(card, edge)
      for (const piece of explosion.pieces) expect(overlaps(at, piece)).toBe(false)
    })
  })
})

describe('outsideCards', () => {
  const place = (x: number, y: number): Box => ({ x, y, w: 120, h: 90 })

  const outside = (box: Box) =>
    box.x + box.w <= 0 ||
    box.x >= PAGE.width ||
    box.y + box.h <= 0 ||
    box.y >= PAGE.height

  /** ⭐ The artwork is what the candidates are being read against. */
  it('leaves the artwork wholly uncovered', () => {
    const boxes = [place(200, 300), place(900, 800), place(600, 1500)]
    const cards = outsideCards(
      boxes.map((b, i) => listed(b, [`ふん${i}`])),
      BASE,
      PAGE,
    )
    expect(cards.every(outside)).toBe(true)
  })

  /**
   * ⭐ Out through the nearest edge, level with its own balloon — poured into
   * one column they would all be equally far from everything, which is the same
   * as being nowhere.
   */
  it('sends each list out through the edge nearest its own place', () => {
    const near = place(60, 800)
    const far = place(PAGE.width - 180, 800)
    const [left] = outsideCards([listed(near, ['ふん'])], BASE, PAGE)
    const [right] = outsideCards([listed(far, ['ふう'])], BASE, PAGE)
    expect(left.x + left.w).toBeLessThanOrEqual(0)
    expect(right.x).toBeGreaterThanOrEqual(PAGE.width)
  })

  it('stands a list level with the place it came off', () => {
    const one = place(60, 800)
    const [card] = outsideCards([listed(one, ['ふん'])], BASE, PAGE)
    expect(card.y + card.h / 2).toBeCloseTo(one.y + one.h / 2, 6)
  })

  it('keeps two of them off each other', () => {
    const a = place(60, 800)
    const b = place(60, 830)
    const cards = outsideCards([listed(a, ['ふん']), listed(b, ['ふう'])], BASE, PAGE)
    expect(overlaps(cards[0], cards[1])).toBe(false)
  })

  it('lays the same page out the same way twice', () => {
    const boxes = [place(200, 900), place(900, 200), place(600, 1400)]
    const lists = boxes.map((b, i) => listed(b, [`ふん${i}`]))
    expect(outsideCards([...lists].reverse(), BASE, PAGE)).toEqual(
      outsideCards(lists, BASE, PAGE),
    )
  })
})

describe('textsOf', () => {
  it('reads out what each row says', () => {
    expect(textsOf(['ふん', 'ふう'].map(read))).toEqual(['ふん', 'ふう'])
  })
})
