import { describe, expect, it } from 'vitest'
import { absorb, type OcrArrival } from './pool'
import { ocrIdentity } from './identity'

const arrival = (over: Partial<OcrArrival> = {}): OcrArrival => ({
  source: 'manga-ocr',
  text: 'ふん！湯気で見間違えたんじゃないの？',
  x: 4230,
  y: 2068,
  width: 377,
  height: 1032,
  confidence: 0.9987,
  label: 'text_bubble',
  ...over,
})

describe('absorb', () => {
  it('takes a reading into an empty pool', () => {
    const { candidates, born } = absorb([], [arrival()])
    expect(candidates).toHaveLength(1)
    expect(born).toEqual([candidates[0].hash])
    expect(candidates[0].text).toBe(candidates[0].original)
  })

  /**
   * The property the whole model rests on. Running the same model twice must
   * leave a correction typed in between exactly where it was — otherwise
   * rerunning quietly destroys work and nobody would dare press the button.
   */
  it('leaves a corrected reading alone when the same model runs again', () => {
    const first = absorb([], [arrival()])
    const corrected = first.candidates.map((c) => ({ ...c, text: '人手改過的' }))

    const second = absorb(corrected, [arrival()])

    expect(second.born).toEqual([])
    expect(second.candidates).toHaveLength(1)
    expect(second.candidates[0].text).toBe('人手改過的')
    expect(second.candidates[0].original).toBe(arrival().text)
  })

  it('takes a second model in beside the first, agreeing or not', () => {
    const one = absorb([], [arrival()])
    // Same box, same characters, different recognizer — two results, and being
    // able to see that they agree is the point.
    const two = absorb(one.candidates, [arrival({ source: 'ppocr', confidence: 0.9912 })])
    expect(two.candidates).toHaveLength(2)
    expect(two.born).toHaveLength(1)
  })

  it('counts one identity once even when a run reports it twice', () => {
    const { candidates, born } = absorb([], [arrival(), arrival()])
    expect(candidates).toHaveLength(1)
    expect(born).toHaveLength(1)
  })

  it('says which identities are new, so a caller can act only on those', () => {
    const first = absorb([], [arrival()])
    const second = absorb(first.candidates, [arrival(), arrival({ text: 'ほかの読み' })])
    expect(second.born).toEqual([ocrIdentity(arrival({ text: 'ほかの読み' }))])
  })

  it('appends rather than reordering what was already there', () => {
    const first = absorb([], [arrival(), arrival({ text: 'b' })])
    const second = absorb(first.candidates, [arrival({ text: 'c' })])
    expect(second.candidates.slice(0, 2)).toEqual(first.candidates)
  })
})
