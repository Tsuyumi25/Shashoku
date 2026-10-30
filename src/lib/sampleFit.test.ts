import { describe, expect, it } from 'vitest'
import { sampleFit } from './sampleFit'

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
  })

  it('leaves an ordinary two-line balloon whole at the default display size', () => {
    expect(sampleFit('等一下……\n你是說真的嗎！？', ROW, false).floored).toBe(false)
  })

  it('floors a column against the box width, which is what its lines stack across', () => {
    expect(sampleFit(lines(10), { w: 120, h: 240 }, true)).toEqual({ sizePx: 24, floored: true })
  })

  it('lets a floored sample cover at most eight boxes, shrinking past the floor if it must', () => {
    const huge = Array.from({ length: 200 }, () => '你是說真的嗎你是說真的嗎你是說真的嗎').join('\n')
    const { sizePx, floored } = sampleFit(huge, ROW, false)
    const area = 18 * sizePx * 1.35 * 200 * sizePx
    expect(floored).toBe(true)
    expect(sizePx).toBeLessThan(24)
    expect(area).toBeLessThanOrEqual(8 * ROW.w * ROW.h)
  })
})
