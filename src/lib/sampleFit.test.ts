import { describe, expect, it } from 'vitest'
import { clipSample, nearestShownIndex, sampleFit, shownIndex, wholeIndex } from './sampleFit'

const ROW = { w: 240, h: 120 }
const lines = (n: number) => Array.from({ length: n }, () => '真的嗎').join('\n')

describe('how large a sample is set in its box', () => {
  it('fills the box while the text is short', () => {
    const one = sampleFit(lines(1), ROW, false)
    const two = sampleFit(lines(2), ROW, false)
    expect(one.floored).toBe(false)
    expect(two.sizePx).toBeLessThan(one.sizePx)
  })

  it('stops at a fifth of the box however many lines there are, and says so', () => {
    expect(sampleFit(lines(10), ROW, false)).toEqual({ sizePx: 24, floored: true })
    expect(sampleFit(lines(40), ROW, false)).toEqual({ sizePx: 24, floored: true })
    const long = Array.from({ length: 200 }, () => '你是說真的嗎你是說真的嗎你是說真的嗎').join('\n')
    expect(sampleFit(long, ROW, false)).toEqual({ sizePx: 24, floored: true })
  })

  it('leaves an ordinary two-line balloon whole at the default display size', () => {
    expect(sampleFit('等一下……\n你是說真的嗎！？', ROW, false).floored).toBe(false)
  })

  it('floors a column against the box width, which is what its lines stack across', () => {
    expect(sampleFit(lines(10), { w: 120, h: 240 }, true)).toEqual({ sizePx: 24, floored: true })
  })
})

describe('what a floored sample draws', () => {
  const twelve = '一二三四五六七八九十甲乙'
  const many = (n: number) => Array.from({ length: n }, () => twelve).join('\n')

  it('keeps the lines its box holds, each cut where it runs out', () => {
    expect(clipSample(many(5), ROW, false, 24).text).toBe(Array(3).fill(twelve.slice(0, 9)).join('\n'))
    expect(clipSample(many(10), { w: 120, h: 240 }, true, 24).text.split('\n')).toHaveLength(3)
  })

  it('never splits a character written in two UTF-16 units', () => {
    const wide = '𠮷'.repeat(12)
    expect(clipSample(wide, ROW, false, 24).text).toBe('𠮷'.repeat(9))
  })

  /** ⚠️ The control holds the whole text; every offset crosses the cut both ways. */
  it('carries offsets between the whole text and what is drawn', () => {
    const clip = clipSample(many(5), ROW, false, 24)
    expect(shownIndex(clip, 14)).toBe(11)
    expect(wholeIndex(clip, 11)).toBe(14)
    expect(shownIndex(clip, 11)).toBeNull()
    expect(nearestShownIndex(clip, 11)).toBe(9)
    expect(nearestShownIndex(clip, 60)).toBe(clip.text.length)
    expect(wholeIndex(clip, 9)).toBe(9)
  })
})
