import { describe, expect, it } from 'vitest'
import type { OcrCandidatePersisted } from '../page/types'
import { claimsOf } from './vote'

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

describe('claimsOf', () => {
  it('finds nothing where nothing was read', () => {
    expect(claimsOf([])).toEqual([])
  })

  it('counts two readers who said the same thing as one claim with two votes', () => {
    const [claim] = claimsOf([
      read({ source: 'manga-ocr', text: 'ふん' }),
      read({ source: 'baberu-ocr', text: 'ふん' }),
    ])
    expect(claim.votes).toBe(2)
    expect(claim.text).toBe('ふん')
  })

  it('keeps two readers who disagree as two claims', () => {
    const claims = claimsOf([
      read({ source: 'manga-ocr', text: 'ふん' }),
      read({ source: 'baberu-ocr', text: 'まったく違う' }),
    ])
    expect(claims).toHaveLength(2)
  })

  it('puts the claim more readers agreed on first', () => {
    const [top] = claimsOf([
      read({ source: 'manga-ocr', text: 'ふん', confidence: 0.7 }),
      read({ source: 'baberu-ocr', text: 'ふん', confidence: 0.7 }),
      read({ source: 'hayai-ocr-v2', text: 'ちがう', confidence: 0.99 }),
    ])
    expect(top.text).toBe('ふん')
  })

  it('breaks a tie in votes on the weight behind them', () => {
    const [top] = claimsOf([
      read({ source: 'manga-ocr', text: 'よわい', confidence: 0.71 }),
      read({ source: 'baberu-ocr', text: 'つよい', confidence: 0.99 }),
    ])
    expect(top.text).toBe('つよい')
  })

  /**
   * ⭐ Only two of the four readers can say where the artwork broke a line. If
   * the break went into the grouping they would form a voting bloc of their own
   * on every balloon — and what is being agreed on is what the artwork says,
   * which a line break is not part of.
   */
  it('counts a broken reading and a flat one as the same claim', () => {
    const [claim] = claimsOf([
      read({ source: 'manga-ocr', text: 'ふん\nそうかい' }),
      read({ source: 'baberu-ocr', text: 'ふんそうかい' }),
    ])
    expect(claim.votes).toBe(2)
  })

  it('prefers the spelling that keeps the line breaks when the votes are tied', () => {
    const [claim] = claimsOf([
      read({ source: 'manga-ocr', text: 'ふん\nそうかい', confidence: 0.9 }),
      read({ source: 'baberu-ocr', text: 'ふんそうかい', confidence: 0.9 }),
    ])
    expect(claim.text).toBe('ふん\nそうかい')
  })

  /** A model reading two boxes of one place is still one reader agreeing. */
  it('gives one reader one vote however many times it spoke', () => {
    const [claim] = claimsOf([
      read({ source: 'manga-ocr', text: 'ふん', confidence: 0.9 }),
      read({ source: 'manga-ocr', text: 'ふん', confidence: 0.8 }),
    ])
    expect(claim.votes).toBe(1)
  })

  it('weighs a reader by its best word, not by how often it repeated itself', () => {
    const [claim] = claimsOf([
      read({ source: 'manga-ocr', text: 'ふん', confidence: 0.9 }),
      read({ source: 'manga-ocr', text: 'ふん', confidence: 0.8 }),
    ])
    expect(claim.weight).toBeCloseTo(0.9)
  })

  it('names the reading that was surest of the claim', () => {
    const [claim] = claimsOf([
      read({ hash: 'meek', source: 'manga-ocr', text: 'ふん', confidence: 0.7 }),
      read({ hash: 'bold', source: 'baberu-ocr', text: 'ふん', confidence: 0.95 }),
    ])
    expect(claim.surest.hash).toBe('bold')
    expect(claim.confidence).toBeCloseTo(0.95)
  })

  /**
   * ⚠️ Two readings counting as one claim is not two readers endorsing either
   * one's spelling. The spelling has to be one somebody actually wrote.
   */
  it('answers with a spelling one of the readers actually used', () => {
    const said = ['ふん\nそうかい', 'ふんそうかい']
    const [claim] = claimsOf([
      read({ source: 'manga-ocr', text: said[0] }),
      read({ source: 'baberu-ocr', text: said[1] }),
    ])
    expect(said).toContain(claim.text)
  })

  /**
   * ⭐ Two readers can agree on the characters, the breaks and the confidence.
   * Which of them speaks for the claim then decides which reading an object
   * comes to stand for, and it must not be settled by who finished first.
   */
  it('settles an exact tie on something that is not arrival order', () => {
    const tied = [
      read({ hash: 'zeta', source: 'manga-ocr', text: 'ふん', confidence: 0.9 }),
      read({ hash: 'alpha', source: 'baberu-ocr', text: 'ふん', confidence: 0.9 }),
    ]
    expect(claimsOf(tied)[0].spokesman.hash).toBe(claimsOf([...tied].reverse())[0].spokesman.hash)
  })

  it('does not depend on the order the readings arrived in', () => {
    const pool = [
      read({ source: 'manga-ocr', text: 'ふん', confidence: 0.9 }),
      read({ source: 'baberu-ocr', text: 'ちがう', confidence: 0.95 }),
      read({ source: 'hayai-ocr-v2', text: 'ふん', confidence: 0.8 }),
    ]
    const forwards = claimsOf(pool).map((c) => c.text)
    const backwards = claimsOf([...pool].reverse()).map((c) => c.text)
    expect(backwards).toEqual(forwards)
  })
})
