import { describe, expect, it } from 'vitest'
import { markDisagreements } from './readingDiff'

/**
 * Every reading with its characters bracketed by what they stand as, so a case
 * reads as the card draws it: bare where every reading agreed, `[]` `{}` `()`
 * for the first, second and later factions, `<>` where a character stands
 * alone.
 */
function shown(texts: readonly string[]): string[] {
  const wraps = ['[]', '{}', '()']
  return markDisagreements(texts).map((row) =>
    row
      .map((mark) => {
        if (mark.unanimous) return mark.ch
        if (mark.faction === null) return `<${mark.ch}>`
        const [open, close] = wraps[Math.min(mark.faction, wraps.length - 1)]
        return `${open}${mark.ch}${close}`
      })
      .join(''),
  )
}

describe('markDisagreements', () => {
  it('marks nothing when two readers wrote the same thing', () => {
    expect(shown(['そんなことない', 'そんなことない'])).toEqual([
      'そんなことない',
      'そんなことない',
    ])
  })

  /** ⭐ The case this exists for: one character apart, and only it is marked. */
  it('marks only the character that differs', () => {
    expect(shown(['何を言ってるの', '何を言つてるの'])).toEqual([
      '何を言<っ>てるの',
      '何を言<つ>てるの',
    ])
  })

  it('marks only the character one reader added', () => {
    expect(shown(['うるさいな', 'うるさいなあ'])).toEqual(['うるさいな', 'うるさいな<あ>'])
  })

  /**
   * ⚠️ The case a straight position-by-position comparison gets wrong. A
   * character dropped early shifts everything after it, and compared without
   * aligning first the whole tail comes out different.
   */
  it('keeps the tail agreed when a character is dropped early', () => {
    expect(shown(['オーイまてー', 'オイまてー'])).toEqual(['オ<ー>イまてー', 'オイまてー'])
  })

  /** The real pair the morphological analyser could not see. */
  it('marks a long mark read as the kanji 一', () => {
    expect(shown(['オーイ、まてー', 'オ一イ、まて一'])).toEqual([
      'オ<ー>イ、まて<ー>',
      'オ<一>イ、まて<一>',
    ])
  })

  /**
   * ⭐ Two of three agreeing is a faction, not unanimity: the 代 and 詞 every
   * reading wrote are bare, the 名 two of them share is the first faction, and
   * the 8 one reading claims alone stands alone.
   */
  it('separates a faction from the reading that stands alone', () => {
    expect(shown(['代名詞', '代名詞', '代8詞'])).toEqual(['代[名]詞', '代[名]詞', '代<8>詞'])
  })

  it('marks both where two readings disagree and neither has company', () => {
    expect(shown(['あいつが', 'あいっが'])).toEqual(['あい<つ>が', 'あい<っ>が'])
  })

  /**
   * ⚠️ Agreement in a gap the pivot has nothing in. Both readers added the same
   * character in the same place, and a column scheme that only named the
   * pivot's own positions would have no way to record that they matched.
   */
  it('holds a character two readings both added to be a faction', () => {
    expect(shown(['あいえお', 'あいうえお', 'あいうえお'])).toEqual([
      'あいえお',
      'あい[う]えお',
      'あい[う]えお',
    ])
  })

  /** ⭐ Four readings splitting two against two: both sides have support. */
  it('tells two factions of equal size apart', () => {
    expect(shown(['あい', 'あい', 'あう', 'あう'])).toEqual(['あ[い]', 'あ[い]', 'あ{う}', 'あ{う}'])
  })

  it('gives a third faction its own standing', () => {
    expect(shown(['あい', 'あい', 'あう', 'あう', 'あえ', 'あえ'])).toEqual([
      'あ[い]',
      'あ[い]',
      'あ{う}',
      'あ{う}',
      'あ(え)',
      'あ(え)',
    ])
  })

  /**
   * ⭐ Nothing to compare against. A lone reading is marked neither way, and
   * the card draws it plainly rather than colouring it.
   */
  it('marks nothing at all when there is only one reading', () => {
    expect(markDisagreements(['ひとりごと'])).toEqual([[]])
  })

  it('holds an empty reading against a full one', () => {
    expect(shown(['', 'ふん'])).toEqual(['', '<ふ><ん>'])
  })

  /** ⚠️ One character to a reader, two code units to a string. */
  it('marks a dropped heart as one character, not half a glyph', () => {
    expect(shown(['すき♥', 'すき'])).toEqual(['すき<♥>', 'すき'])
    expect(shown(['すき😊', 'すき'])).toEqual(['すき<😊>', 'すき'])
  })

  it('lines a reading up across a line break the other does not have', () => {
    expect(shown(['あいうえお', 'あいう\nえお'])).toEqual(['あいうえお', 'あいう<\n>えお'])
  })

  it('marks the same page the same way whatever order the readings arrive in', () => {
    expect(shown(['あいつが', 'あいっが'])).toEqual(['あい<つ>が', 'あい<っ>が'])
    expect(shown(['あいっが', 'あいつが'])).toEqual(['あい<っ>が', 'あい<つ>が'])
  })

  it('returns every character of every reading, marked one way or another', () => {
    const texts = ['何を言ってるの', '何を言つてるの', 'なにを言ってるの']
    markDisagreements(texts).forEach((row, at) => {
      expect(row.map((mark) => mark.ch).join('')).toBe(texts[at])
    })
  })
})
