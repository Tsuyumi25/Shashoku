import { describe, expect, it } from 'vitest'
import type { OcrCandidatePersisted } from '../page/types'
import { OFFER_FLOOR, offeredReadings, type Claimant } from './offer'

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

const object = (from?: string): Claimant => ({ source: from === undefined ? {} : { from } })

const offered = (
  pool: readonly OcrCandidatePersisted[],
  objects: readonly Claimant[],
  ownScale: ReadonlySet<string> = new Set(),
): string[] => offeredReadings(pool, objects, ownScale).map((r) => r.hash)

describe('offeredReadings', () => {
  it('offers a reading nothing on the page answers for', () => {
    const one = read()
    expect(offered([one], [])).toEqual([one.hash])
  })

  /**
   * ⭐ The edge hangs on the object, which is why this needs no code of its own:
   * the reference goes when the object goes.
   */
  it('stops offering a reading an object was made from, and offers it again once that object is gone', () => {
    const one = read()
    expect(offered([one], [object(one.hash)])).toEqual([])
    expect(offered([one], [])).toEqual([one.hash])
  })

  /**
   * Correcting the words by hand touches the object and not the certificate, so
   * nothing here changes — which is the answer wanted: somebody has dealt with
   * this reading.
   */
  it('goes on refusing a reading whose object has since been retyped', () => {
    const one = read()
    // What retyping does is write `lines`; `from` is untouched, and this
    // function never looks at either.
    expect(offered([one], [object(one.hash)])).toEqual([])
  })

  it('offers a reading nobody points at, alongside one somebody does', () => {
    const answered = read()
    const loose = read()
    expect(offered([answered, loose], [object(answered.hash)])).toEqual([loose.hash])
  })

  /**
   * ⭐ The losing reading of an argument three models had. Without this it would
   * stand beside a balloon that was settled hours ago, for ever.
   */
  it('stops offering a reading somebody set aside', () => {
    const aside = read({ setAside: true })
    expect(offered([aside], [])).toEqual([])
  })

  it('answers the same for a set-aside reading whether or not anything points at it', () => {
    const aside = read({ setAside: true })
    expect(offered([aside], [object(aside.hash)])).toEqual([])
    expect(offered([aside], [])).toEqual([])
  })

  /** Swapping which reading an object stands on hands the old one back. */
  it('offers the reading an object has just been taken off', () => {
    const was = read()
    const now = read()
    expect(offered([was, now], [object(now.hash)])).toEqual([was.hash])
  })

  /** A certificate naming a reading the pool has lost holds nothing back. */
  it('is untroubled by an object naming a reading that is gone', () => {
    const one = read()
    expect(offered([one], [object('vanished')])).toEqual([one.hash])
  })

  /**
   * ⭐ A reading nobody would ever pick still costs a row to read past, and a
   * page of hand-drawn lettering has four of them at every balloon.
   */
  it('holds back a reading nobody would pick', () => {
    const noise = read({ confidence: OFFER_FLOOR - 0.01 })
    expect(offered([noise], [])).toEqual([])
  })

  it('offers one exactly on the line', () => {
    const edge = read({ confidence: OFFER_FLOOR })
    expect(offered([edge], [])).toEqual([edge.hash])
  })

  /**
   * ⭐ A confidence is only comparable between readers who mean the same thing
   * by it. Held to the others' line, the reader asked about hand-drawn
   * lettering would be the first thing cut from the pages that need it.
   */
  it('offers a reader on a scale of its own, below the line', () => {
    const low = read({ source: 'hayai-ocr-v2', confidence: 0.2 })
    expect(offered([low], [], new Set(['hayai-ocr-v2']))).toEqual([low.hash])
    expect(offered([low], [])).toEqual([])
  })

  /** ⚠️ The pool keeps it, and the page's own decision still weighs it. */
  it('says nothing about a reading beyond whether to show it', () => {
    const noise = read({ confidence: 0.2 })
    const pool = [noise]
    offered(pool, [])
    expect(pool).toEqual([noise])
  })

  it('keeps the pool order, so a page shown twice is shown the same way', () => {
    const a = read()
    const b = read()
    const c = read()
    expect(offered([a, b, c], [object(b.hash)])).toEqual([a.hash, c.hash])
  })
})
