import { describe, expect, it } from 'vitest'
import { editDistance, sameClaim } from './similar'

describe('editDistance', () => {
  it('is zero between a reading and itself', () => {
    expect(editDistance('ふんそうかい', 'ふんそうかい')).toBe(0)
  })

  it('counts a substituted character once', () => {
    expect(editDistance('ふんっ', 'ふんつ')).toBe(1)
  })

  it('counts a dropped character once', () => {
    expect(editDistance('ふんっ！', 'ふんっ')).toBe(1)
  })

  it('counts the whole of one string when the other is empty', () => {
    expect(editDistance('ふんっ', '')).toBe(3)
  })

  /** ⚠️ A heart is one character to a reader and two code units to a string. */
  it('counts a dropped heart once, not twice', () => {
    expect(editDistance('すき♥', 'すき')).toBe(1)
    expect(editDistance('すき😊', 'すき')).toBe(1)
  })
})

describe('sameClaim', () => {
  it('holds a reading to be the same as itself', () => {
    expect(sameClaim('ふん', 'ふん')).toBe(true)
  })

  it('holds two unrelated readings apart', () => {
    expect(sameClaim('ふんそうかい', 'まったくちがうことば')).toBe(false)
  })

  /**
   * ⭐ Small っ for large つ, one heart missing. Two readers reading one balloon
   * differ like this constantly, and left apart they are two votes where there
   * is one — a false signal of uncertainty, arriving exactly where the count is
   * deciding whether to create an object.
   */
  it('folds a long reading that is one character out', () => {
    expect(sameClaim('ふんっ湯気で見間違えたんじゃないの', 'ふんつ湯気で見間違えたんじゃないの')).toBe(
      true,
    )
  })

  /**
   * ⭐ And does not fold a short one. A sound effect or a single word is where
   * the models are least reliable, so one character apart there is a real
   * disagreement rather than noise — and hiding it would report agreement the
   * page does not have.
   */
  it('keeps two short readings one character apart as two claims', () => {
    expect(sameClaim('ドン', 'トン')).toBe(false)
    expect(sameClaim('ふんっ', 'ふんつ')).toBe(false)
  })

  /**
   * ⚠️ The case a plain ratio gets wrong. At five characters a fifth is one, so
   * a ratio alone starts folding sound effects together the moment they are long
   * enough to round up.
   */
  it('still keeps a five-character reading one character out apart', () => {
    expect(sameClaim('ドドドドン', 'ドドドドソ')).toBe(false)
  })

  it('folds a long reading that is two characters out', () => {
    const said = 'あのときのことをぜんぶ覚えているんだね'
    expect(sameClaim(said, said.replace('ぜんぶ', 'ぜんふ').replace('覚', '賞'))).toBe(true)
  })

  it('does not fold a long reading that is out by a quarter of itself', () => {
    expect(sameClaim('あのときのことをぜんぶ覚えているんだね', 'ぜんぜんちがうながいぶんしょうです')).toBe(
      false,
    )
  })

  it('does not care which way round it is asked', () => {
    const [a, b] = ['ふんっ湯気で見間違えたんじゃないの', 'ふんつ湯気で見間違えたんじゃないの']
    expect(sameClaim(b, a)).toBe(sameClaim(a, b))
  })

  it('holds two empty readings to be the same', () => {
    expect(sameClaim('', '')).toBe(true)
  })
})
