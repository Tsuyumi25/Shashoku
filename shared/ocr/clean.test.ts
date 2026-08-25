import { describe, expect, it } from 'vitest'
import { fold } from './clean'

describe('fold', () => {
  it('brings the two spellings of a bang together', () => {
    expect(fold('ふん!')).toBe(fold('ふん！'))
  })

  it('brings the two spellings of a query together', () => {
    expect(fold('なに?')).toBe(fold('なに？'))
  })

  it('settles on the full-width form, which is what the artwork is set in', () => {
    expect(fold('ふん!')).toBe('ふん！')
    expect(fold('なに?')).toBe('なに？')
  })

  it('folds a wave dash and a full-width tilde into one', () => {
    expect(fold('あ〜')).toBe(fold('あ～'))
  })

  it('folds half-width kana up to the width the page is set in', () => {
    expect(fold('ｱｲｳ')).toBe('アイウ')
  })

  it('composes a half-width voiced mark onto the kana it belongs to', () => {
    expect(fold('ﾊﾞ')).toBe('バ')
  })

  it('folds the half-width brackets and stops', () => {
    expect(fold('｢あ｣')).toBe('「あ」')
  })

  it('folds three periods into the ellipsis they stand for', () => {
    expect(fold('あ...')).toBe('あ…')
  })

  it('folds a longer run of periods into ellipses', () => {
    expect(fold('あ......')).toBe('あ……')
  })

  it('leaves one period and two periods alone', () => {
    expect(fold('あ..')).toBe('あ..')
  })

  it('folds the midline horizontal ellipsis onto the ordinary one', () => {
    expect(fold('あ⋯')).toBe('あ…')
  })

  it('drops the space around a reading without touching the one inside it', () => {
    expect(fold('  あ い  ')).toBe('あ い')
  })

  it('keeps the line breaks a reader took the trouble to find', () => {
    expect(fold('あい\nうえ')).toBe('あい\nうえ')
  })

  it('leaves a reading with nothing to fold exactly as it was', () => {
    expect(fold('ふんっ、そうかい')).toBe('ふんっ、そうかい')
  })

  it('answers empty for empty', () => {
    expect(fold('')).toBe('')
  })
})
