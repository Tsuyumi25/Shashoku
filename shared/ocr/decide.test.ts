import { describe, expect, it } from 'vitest'
import type { OcrCandidatePersisted } from '../page/types'
import { decide, type Standing } from './decide'

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
  confidence: 0.99,
  label: 'text_bubble',
  ...over,
})

/** The four readers agreeing on one balloon, which is the ordinary case. */
const agreed = (over: Partial<OcrCandidatePersisted> = {}) =>
  ['manga-ocr', 'ppocr-v6', 'baberu-ocr', 'hayai-ocr-v2'].map((source) =>
    read({ source, ...over }),
  )

const object = (over: Partial<Standing> = {}): Standing => ({
  id: 'o1',
  centre: { x: 200, y: 300 },
  source: { by: 'auto' },
  ...over,
})

describe('decide', () => {
  it('does nothing with an empty pool', () => {
    const verdict = decide([object()], [])
    expect(verdict.fills.size).toBe(0)
    expect(verdict.spawns).toEqual([])
  })

  it('fills the object standing in a place the readers agreed on', () => {
    const pool = agreed()
    const verdict = decide([object()], pool)
    expect(verdict.fills.get('o1')?.text).toBe('ふん')
    expect(pool.map((r) => r.hash)).toContain(verdict.fills.get('o1')?.from)
  })

  it('creates nothing where an object already stands', () => {
    expect(decide([object()], agreed()).spawns).toEqual([])
  })

  /** Whether that object has answered yet is beside the point — it is there. */
  it('creates nothing where an unanswered object stands', () => {
    const standing = object({ source: { by: 'human' } })
    expect(decide([standing], agreed()).spawns).toEqual([])
  })

  it('leaves an object a person answered for exactly as it is', () => {
    const standing = object({ source: { from: 'chosen', by: 'human' } })
    expect(decide([standing], agreed()).fills.size).toBe(0)
  })

  it('creates an object where nothing stands and the readers were sure', () => {
    const verdict = decide([], agreed())
    expect(verdict.spawns).toHaveLength(1)
    expect(verdict.spawns[0].text).toBe('ふん')
  })

  it('stands a new object in the middle of the place it was read', () => {
    const [born] = decide([], agreed({ x: 100, y: 100, w: 200, h: 400 })).spawns
    expect(born.centre).toEqual({ x: 200, y: 300 })
  })

  it('gives a new object the direction and size the run measured', () => {
    const [born] = decide([], agreed({ vertical: true, fontSizePx: 38, leadingPercent: 118 }))
      .spawns
    expect(born).toMatchObject({ vertical: true, fontSizePx: 38, leadingPercent: 118 })
  })

  /**
   * ⭐ The two floors are not the same height because the two mistakes are not
   * the same size. A wrong fill leaves the object where it was with the wrong
   * words in it; a wrong creation is a piece of rubbish somebody has to notice
   * before they can delete it.
   */
  it('fills at a confidence it would not create at', () => {
    const middling = agreed({ confidence: 0.8 })
    expect(decide([object()], middling).fills.size).toBe(1)
    expect(decide([], middling).spawns).toEqual([])
  })

  it('does not fill from a reading nobody should trust', () => {
    expect(decide([object()], agreed({ confidence: 0.4 })).fills.size).toBe(0)
  })

  /**
   * ⭐ Two questions, asked separately. Asking only the winner would let a
   * source that may not create win the vote and take the whole place down with
   * it.
   */
  it('creates from an allowed source while saying what the winner said', () => {
    const pool = [
      read({ source: 'untrusted', text: 'かって に かった', confidence: 0.99 }),
      read({ source: 'untrusted', text: 'かって に かった', confidence: 0.99 }),
      read({ source: 'manga-ocr', text: 'ふん', confidence: 0.99 }),
    ]
    // Two votes to one, so the untrusted reading wins the vote outright.
    const verdict = decide([], pool, new Set(['untrusted']))
    expect(verdict.spawns).toHaveLength(1)
    expect(verdict.spawns[0].text).toBe('かって に かった')
  })

  it('creates nothing where only a source that may not create is sure', () => {
    const pool = agreed().map((r) => ({ ...r, source: 'untrusted' }))
    expect(decide([], pool, new Set(['untrusted'])).spawns).toEqual([])
  })

  it('still fills an object from a source that may not create', () => {
    const pool = agreed().map((r) => ({ ...r, source: 'untrusted' }))
    expect(decide([object()], pool, new Set(['untrusted'])).fills.size).toBe(1)
  })

  /** ⭐ Two neighbouring balloons must not both reach for one object. */
  it('gives a contested object to the stronger place and leaves the other empty', () => {
    const strong = agreed({ x: 100, y: 100, w: 200, h: 200, text: 'つよい' })
    const weak = [read({ x: 260, y: 100, w: 200, h: 200, text: 'よわい', confidence: 0.99 })]
    // Sits inside both circles, nearer the weaker one.
    const contested = object({ centre: { x: 330, y: 200 } })

    const verdict = decide([contested], [...strong, ...weak])
    expect(strong.map((r) => r.hash)).toContain(verdict.fills.get('o1')?.from)
    // The place that lost the object is now a place with no object, so it is
    // free to create one of its own.
    expect(verdict.spawns.map((s) => s.text)).toEqual(['よわい'])
  })

  it('never puts one object in two places', () => {
    const here = agreed({ x: 100, y: 100, w: 200, h: 200, text: 'ここ' })
    const there = agreed({ x: 260, y: 100, w: 200, h: 200, text: 'あちら' })
    const verdict = decide([object({ centre: { x: 330, y: 200 } })], [...here, ...there])
    expect(verdict.fills.size).toBe(1)
  })

  it('leaves an object nowhere near anything alone', () => {
    expect(decide([object({ centre: { x: 4000, y: 4000 } })], agreed()).fills.size).toBe(0)
  })

  /**
   * ⭐ The property four readers finishing in any order rests on. The decision
   * reads the whole pool, so nothing about it can depend on who got back first.
   */
  it('answers the same however the pool is ordered', () => {
    const pool = [...agreed({ x: 100, y: 100, text: 'ここ' }), ...agreed({ x: 900, y: 900, text: 'あちら' })]
    const objects = [object({ id: 'a' }), object({ id: 'b', centre: { x: 1000, y: 1100 } })]

    const forwards = decide(objects, pool)
    const backwards = decide(objects, [...pool].reverse())
    expect([...backwards.fills.keys()].sort()).toEqual([...forwards.fills.keys()].sort())
    expect(backwards.spawns.map((s) => s.text).sort()).toEqual(
      forwards.spawns.map((s) => s.text).sort(),
    )
  })

  /**
   * ⭐ What makes drawing an empty object and pressing again work. Nothing new
   * was read; the decision is simply taken over.
   */
  it('fills an object drawn after the reading, with no new reading at all', () => {
    const pool = agreed()
    expect(decide([], pool).spawns).toHaveLength(1)
    expect(decide([object()], pool).fills.size).toBe(1)
  })

  /**
   * ⭐ What "running it again is free" has to mean beyond the pool not growing:
   * no step on the undo stack and no page marked for saving.
   */
  it('reports nothing for an object already standing on the answer', () => {
    const pool = agreed()
    const settled = decide([object()], pool).fills.get('o1')
    expect(decide([object({ source: { by: 'auto', from: settled!.from } })], pool).fills.size).toBe(0)
  })

  it('carries the winner’s line breaks onto the object it creates', () => {
    const [born] = decide([], agreed({ text: 'ふん\nそうかい' })).spawns
    expect(born.text).toBe('ふん\nそうかい')
  })
})
