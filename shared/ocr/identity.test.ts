import { describe, expect, it } from 'vitest'
import { ocrIdentity, type OcrBirth } from './identity'

const BIRTH: OcrBirth = {
  source: 'manga-ocr',
  text: 'ふん！湯気で見間違えたんじゃないの？',
  x: 4230,
  y: 2068,
  width: 377,
  height: 1032,
  confidence: 0.9987,
}

describe('ocrIdentity', () => {
  it('gives one birth the same identity every time it is asked', () => {
    expect(ocrIdentity(BIRTH)).toBe(ocrIdentity({ ...BIRTH }))
  })

  it('lets every field of a birth move the answer', () => {
    const seen = new Set([ocrIdentity(BIRTH)])
    seen.add(ocrIdentity({ ...BIRTH, source: 'ppocr' }))
    seen.add(ocrIdentity({ ...BIRTH, text: `${BIRTH.text}！` }))
    seen.add(ocrIdentity({ ...BIRTH, x: BIRTH.x + 1 }))
    seen.add(ocrIdentity({ ...BIRTH, y: BIRTH.y + 1 }))
    seen.add(ocrIdentity({ ...BIRTH, width: BIRTH.width + 1 }))
    seen.add(ocrIdentity({ ...BIRTH, height: BIRTH.height + 1 }))
    seen.add(ocrIdentity({ ...BIRTH, confidence: 0.9988 }))
    expect(seen.size).toBe(8)
  })

  /**
   * What the separator is for: two births that differ only in where one field
   * ends and the next begins. Run together they are one string, and the second
   * candidate would silently take the first one's place.
   */
  it('keeps two births apart when only the field boundary moved', () => {
    expect(ocrIdentity({ ...BIRTH, source: 'ab', text: 'c' })).not.toBe(
      ocrIdentity({ ...BIRTH, source: 'a', text: 'bc' }),
    )
  })

  it('answers in hex, sixty-four bits of it', () => {
    expect(ocrIdentity(BIRTH)).toMatch(/^[0-9a-f]{16}$/)
  })
})
