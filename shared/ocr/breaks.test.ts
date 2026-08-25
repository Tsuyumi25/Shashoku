import { describe, expect, it } from 'vitest'
import { settleBreaks } from './breaks'

const said = (text: string, confidence = 0.9) => ({ text, confidence })

/** What each reading reads as afterwards, in the order it went in. */
const after = (readings: { text: string; confidence: number }[]) =>
  settleBreaks(readings).map((r) => r.text)

describe('settleBreaks', () => {
  it('leaves one lonely flat reading flat', () => {
    expect(after([said('ふんっ湯気で見間違えた')])).toEqual(['ふんっ湯気で見間違えた'])
  })

  /** ⭐ A reader that found the breaks itself is the authority on its own text. */
  it('leaves a reading that already knows its own breaks alone', () => {
    const mine = 'ふんっ\n湯気で\n見間違えた'
    expect(after([said(mine), said('ふんっ湯気で見間違えたよ')])[0]).toBe(mine)
  })

  /**
   * ⭐ Only two of the four readers can say where the artwork broke a line, so
   * the reading that wins the vote usually cannot. It borrows from one that can.
   */
  it('gives a flat reading the breaks a neighbour found', () => {
    const [, borrowed] = after([
      said('ふんっ\n湯気で\n見間違えた'),
      said('ふんっ湯気で見間違えた'),
    ])
    expect(borrowed).toBe('ふんっ\n湯気で\n見間違えた')
  })

  /**
   * ⭐ The whole of this change. The template is one character shorter, and the
   * extra character is at the front rather than spread evenly through — so
   * cutting by the ratio of the character counts pushes every break one place
   * left. Aligning the characters puts them where they belong.
   */
  it('puts the breaks where the characters line up, not where the counts do', () => {
    const [, borrowed] = after([
      said('ふんっ\n湯気で\n見間違えた'),
      said('あふんっ湯気で見間違えた'),
    ])
    expect(borrowed).toBe('あふんっ\n湯気で\n見間違えた')
  })

  it('aligns every break, not just the first', () => {
    const [, borrowed] = after([
      said('あいう\nえおか\nきくけ\nこさし'),
      said('あいう。えおか。きくけ。こさし'),
    ])
    expect(borrowed).toBe('あいう。\nえおか。\nきくけ。\nこさし')
  })

  it('handles a template longer than the reading it lends to', () => {
    const [, borrowed] = after([
      said('あいうえ\nおかきく\nけこさし'),
      said('いうえ\nおかきく\nけこさし'.replace(/\n/g, '')),
    ])
    expect(borrowed).toBe('いうえ\nおかきく\nけこさし')
  })

  /**
   * ⚠️ Without the gate, a model that read something else entirely at this place
   * lends its breaks to the winner on the strength of having two lines.
   */
  it('refuses a template that read something else entirely', () => {
    const [, borrowed] = after([
      said('ここは\nまったくちがう', 0.99),
      said('ふんっ湯気で見間違えた'),
    ])
    expect(borrowed).toBe('ふんっ湯気で見間違えた')
  })

  it('takes the template with the most lines, then the surest', () => {
    const [, , , borrowed] = after([
      said('あいうえおかきくけこ\nさしすせそ', 0.99),
      said('あいうえお\nかきくけこ\nさしすせそ', 0.7),
      said('あいうえお\nかきくけこ\nさしすせそ', 0.8),
      said('あいうえおかきくけこさしすせそ'),
    ])
    expect(borrowed).toBe('あいうえお\nかきくけこ\nさしすせそ')
  })

  it('leaves everything flat when no reading knows any breaks', () => {
    const flat = ['ふんっ湯気で見間違えた', 'ふんっ湯気で見間違えたよ']
    expect(after(flat.map((t) => said(t)))).toEqual(flat)
  })

  it('does not answer with an empty line where a break landed on the end', () => {
    expect(after([said('あい\nうえ'), said('あいうえ')]).every((t) => !t.includes('\n\n'))).toBe(
      true,
    )
  })

  it('answers nothing for nothing', () => {
    expect(settleBreaks([])).toEqual([])
  })

  it('keeps everything else about a reading untouched', () => {
    const [borrowed] = settleBreaks([
      { text: 'あいうえ', confidence: 0.83, source: 'baberu-ocr' },
      { text: 'あい\nうえ', confidence: 0.7, source: 'manga-ocr' },
    ])
    expect(borrowed).toMatchObject({ confidence: 0.83, source: 'baberu-ocr' })
  })
})
