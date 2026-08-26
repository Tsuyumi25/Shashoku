import { describe, expect, it } from 'vitest'
import type { OcrCandidatePersisted } from '@shared/page/types'
import type { Box } from '@shared/ocr/places'
import {
  cardSize,
  CROWDED,
  crowding,
  outsideCards,
  planCards,
  textsOf,
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

describe('planCards', () => {
  const place = (x: number, y: number): Box => ({ x, y, w: 120, h: 90 })

  it('stands a card beside the place it came off', () => {
    const one = place(400, 500)
    const [card] = planCards([listed(one, ['ふん'])], [one], BASE, PAGE)
    expect(overlaps(card, one)).toBe(false)
    expect(card.from).toEqual(one)
  })

  it('covers neither a place nor an object', () => {
    const mine = place(400, 500)
    const neighbour = place(560, 500)
    const object: Box = { x: 400, y: 620, w: 140, h: 60 }
    const [card] = planCards([listed(mine, ['ふん'])], [mine, neighbour, object], BASE, PAGE)
    expect(overlaps(card, mine)).toBe(false)
    expect(overlaps(card, neighbour)).toBe(false)
    expect(overlaps(card, object)).toBe(false)
  })

  it('keeps two cards off each other', () => {
    const a = place(300, 300)
    const b = place(300, 700)
    const cards = planCards(
      [listed(a, ['ふん']), listed(b, ['そうかい'])],
      [a, b],
      BASE,
      PAGE,
    )
    expect(cards).toHaveLength(2)
    expect(overlaps(cards[0], cards[1])).toBe(false)
  })

  /**
   * ⭐ A card somewhere awkward can be dragged; a card that was never drawn
   * cannot be found. So a page with nowhere clear still gets every card.
   */
  it('takes the least blocked side when every side is blocked, rather than giving up', () => {
    const middle = place(500, 700)
    const size = cardSize(['ふん'], BASE)
    // One obstacle squarely on each of the four sides, so nothing is free. The
    // one to the left is a sliver and the other three are the whole card.
    const sides = [
      { x: middle.x + middle.w, y: middle.y, w: size.w * 2, h: size.h * 2 },
      { x: middle.x - size.w, y: middle.y, w: size.w / 8, h: size.h * 2 },
      { x: middle.x, y: middle.y + middle.h, w: size.w * 2, h: size.h * 2 },
      { x: middle.x - size.w, y: middle.y - size.h * 2, w: size.w * 3, h: size.h * 2 },
    ]
    const [card] = planCards([listed(middle, ['ふん'])], [middle, ...sides], BASE, PAGE)
    expect(card).toBeDefined()
    // The sliver's side: everywhere else swallows the card whole.
    expect(card.x).toBeLessThan(middle.x)
  })

  /**
   * ⭐ A box this size is not something a card can hide — it lands on a corner
   * and the rest is still there to read — while refusing to cover it would
   * leave its own card nowhere to go.
   */
  it('does not treat a box covering much of the page as an obstacle', () => {
    const one = place(500, 700)
    const huge: Box = { x: 0, y: 0, w: PAGE.width, h: PAGE.height }
    const [card] = planCards([listed(one, ['ふん'])], [one, huge], BASE, PAGE)
    expect(overlaps(card, huge)).toBe(true)
  })

  it('keeps a card on the page rather than hanging it off the edge', () => {
    const edge: Box = { x: 1050, y: 500, w: 120, h: 90 }
    const [card] = planCards([listed(edge, ['ふん'])], [edge], BASE, PAGE)
    expect(card.x).toBeGreaterThanOrEqual(0)
    expect(card.x + card.w).toBeLessThanOrEqual(PAGE.width)
  })

  /** ⭐ The order the pool happens to be in is not something a reader can see. */
  it('plans the same page the same way twice, whatever order it is handed', () => {
    const boxes = [place(300, 900), place(700, 200), place(200, 500)]
    const lists = boxes.map((b, i) => listed(b, [`ふん${i}`]))
    const forwards = planCards(lists, boxes, BASE, PAGE)
    const backwards = planCards([...lists].reverse(), boxes, BASE, PAGE)
    expect(backwards).toEqual(forwards)
  })

  /**
   * ⭐ What makes working through a list a row at a time possible: the row
   * under the pointer stays under the pointer.
   */
  it('leaves a card exactly where it was when a row is taken out of it', () => {
    const one = place(400, 500)
    const full = ['ふん', 'そうかい', 'ふう'].map(read)
    const before = planCards([{ ...one, full, readings: full }], [one], BASE, PAGE)
    const after = planCards(
      [{ ...one, full, readings: full.slice(1) }],
      [one],
      BASE,
      PAGE,
    )
    expect(after[0].x).toBe(before[0].x)
    expect(after[0].y).toBe(before[0].y)
    expect(after[0].w).toBe(before[0].w)
    expect(after[0].h).toBe(before[0].h)
  })

  it('answers to the place it is about, so a card keeps its name across a redraw', () => {
    const one = place(400, 500)
    const [card] = planCards([listed(one, ['ふん'])], [one], BASE, PAGE)
    expect(card.key).toBe('400,500,120,90')
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

describe('crowding', () => {
  const place = (x: number, y: number): Box => ({ x, y, w: 120, h: 90 })

  it('spends nothing on a page with room to spare', () => {
    const one = place(400, 500)
    const cards = planCards([listed(one, ['ふん'])], [one], BASE, PAGE)
    expect(crowding(cards, [one], PAGE)).toBeCloseTo(0, 9)
  })

  /**
   * ⭐ Not a count of the lists but a measure of whether there was anywhere to
   * stand — which is the thing that decides whether a page can hold them.
   */
  it('reports a page with nowhere to stand as crowded', () => {
    const boxes: Box[] = []
    for (let y = 0; y < PAGE.height; y += 150) {
      for (let x = 0; x < PAGE.width; x += 150) boxes.push({ x, y, w: 140, h: 140 })
    }
    const lists = boxes.map((b, i) => listed(b, [`ふん${i}`, `ふう${i}`, `ふーん${i}`]))
    const cards = planCards(lists, boxes, BASE, PAGE)
    expect(crowding(cards, boxes, PAGE)).toBeGreaterThan(CROWDED)
  })
})

describe('textsOf', () => {
  it('reads out what each row says', () => {
    expect(textsOf(['ふん', 'ふう'].map(read))).toEqual(['ふん', 'ふう'])
  })
})
