import { describe, expect, it } from 'vitest'
import { settleBreaks } from './breaks'

const said = (text: string, confidence = 0.9) => ({ text, confidence })

/** What each reading reads as afterwards, in the order it went in. */
const after = (readings: { text: string; confidence: number }[], lines: number[] = []) =>
  settleBreaks(readings, lines).map((r) => r.text)

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
    expect(settleBreaks([], [])).toEqual([])
  })

  it('keeps everything else about a reading untouched', () => {
    const [borrowed] = settleBreaks(
      [
        { text: 'あいうえ', confidence: 0.83, source: 'baberu-ocr' },
        { text: 'あい\nうえ', confidence: 0.7, source: 'manga-ocr' },
      ],
      [],
    )
    expect(borrowed).toMatchObject({ confidence: 0.83, source: 'baberu-ocr' })
  })
})

describe('settleBreaks, against the lines the artwork was measured to have', () => {
  /**
   * ⭐ Nobody at this place found a break, but something went and measured where
   * the lines are. Dividing the characters evenly would be guessing at the very
   * thing there is a measurement of.
   */
  it('breaks a lonely reading over the lines that were measured', () => {
    expect(after([said('あいうえおかきくけこさし')], [150, 150, 60])).toEqual([
      'あいうえお\nかきくけこ\nさし',
    ])
  })

  it('does not divide the characters evenly between lines of different lengths', () => {
    const [broken] = after([said('あいうえおかきくけこさし')], [150, 150, 60])
    expect(broken).not.toBe('あいうえ\nおかきく\nけこさし')
  })

  it('follows a long first line and two short ones', () => {
    expect(after([said('あいうえおかきくけこ')], [300, 100, 100])).toEqual([
      'あいうえおか\nきく\nけこ',
    ])
  })

  /** The reader that found its own breaks still outranks a measurement. */
  it('leaves a reading that knows its own breaks alone', () => {
    expect(after([said('あい\nうえおかきくけこさし')], [150, 150, 60])[0]).toBe(
      'あい\nうえおかきくけこさし',
    )
  })

  /** ⭐ And a template that read the same sentence still outranks it. */
  it('prefers a template that says the same thing over the measurement', () => {
    const [, borrowed] = after(
      [said('あいうえ\nおかきくけこさし'), said('あいうえおかきくけこさし')],
      [150, 150, 60],
    )
    expect(borrowed).toBe('あいうえ\nおかきくけこさし')
  })

  it('leaves a reading flat where only one line was measured', () => {
    expect(after([said('あいうえおかきくけこさし')], [150])).toEqual(['あいうえおかきくけこさし'])
  })

  it('leaves a reading flat where nothing was measured', () => {
    expect(after([said('あいうえおかきくけこさし')], [])).toEqual(['あいうえおかきくけこさし'])
  })

  it('does not make more lines than it has characters', () => {
    expect(after([said('あい')], [150, 150, 60])).toEqual(['あ\nい'])
  })

  it('never answers an empty line', () => {
    for (const lines of [[300, 1, 1], [1, 1, 300], [5, 5, 5, 5, 5, 5]]) {
      for (const text of ['あいう', 'あ', 'あいうえおか']) {
        expect(after([said(text)], lines)[0].split('\n').every((l) => l.length > 0)).toBe(true)
      }
    }
  })
})

/**
 * ⭐ The measured columns are not always the sentence's. When they describe
 * something else — marks read as lines of their own, columns found in the
 * artwork around the balloon — sharing the characters out over them produces a
 * stack of scraps, and no guess beats a bad one.
 */
describe('settleBreaks, refusing a break that shreds the reading', () => {
  it('refuses a break past the height anything is lettered at', () => {
    const text = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひ'
    expect(after([said(text)], Array(9).fill(10))).toEqual([text])
  })

  it('takes one exactly at that height, where the lines are worth reading', () => {
    const text = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみ'
    expect(after([said(text)], Array(8).fill(10))[0].split('\n')).toHaveLength(8)
  })

  it('refuses a short stack that is mostly scraps', () => {
    const text = 'あいうえおかきくけこさしす'
    expect(after([said(text)], [100, 20, 20, 20, 100])).toEqual([text])
  })

  it('takes a short stack that is not', () => {
    expect(after([said('あいうえおかきくけこさしすせそたち')], [100, 20, 20, 100, 100])).toEqual([
      'あいうえお\nか\nき\nくけこさし\nすせそたち',
    ])
  })

  /**
   * ⚠️ Only our own guesses are refused. A balloon really can be lettered one
   * character to the line, and a reader that saw that is reporting the artwork
   * rather than guessing at it.
   */
  it('leaves a reading that found its own breaks however tall it stands', () => {
    const tall = 'あ\nい\nう\nえ\nお\nか\nき\nく\nけ'
    expect(after([said(tall)], Array(9).fill(10))).toEqual([tall])
  })

  it('refuses to transplant a break that would shred the reading it lands on', () => {
    const tall = 'あ\nい\nう\nえ\nお\nか\nき\nく\nけ'
    expect(after([said(tall, 0.9), said('あいうえおかきくけ', 0.8)])).toEqual([
      tall,
      'あいうえおかきくけ',
    ])
  })
})
