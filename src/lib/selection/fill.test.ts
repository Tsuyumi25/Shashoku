import { describe, expect, it } from 'vitest'
import { fillPixels } from '@/lib/selection/fill'

describe('fillPixels', () => {
  const red = { r: 255, g: 0, b: 0 }

  it('carries the mask through as the alpha channel', () => {
    const alpha = new Uint8ClampedArray([0, 128, 255, 64])
    const out = fillPixels(alpha, red)
    expect([...out.slice(0, 4)]).toEqual([255, 0, 0, 0])
    expect([...out.slice(4, 8)]).toEqual([255, 0, 0, 128])
    expect([...out.slice(8, 12)]).toEqual([255, 0, 0, 255])
    expect([...out.slice(12, 16)]).toEqual([255, 0, 0, 64])
  })

  /**
   * A soft edge is the whole reason the mask is 8-bit rather than a set of
   * pixels, and clipping it here would put a jagged patch on the page.
   */
  it('keeps a feathered edge rather than clipping it to on or off', () => {
    const out = fillPixels(new Uint8ClampedArray([200]), red)
    expect(out[3]).toBe(200)
  })

  it('gives four bytes per mask pixel', () => {
    expect(fillPixels(new Uint8ClampedArray(6), red)).toHaveLength(24)
  })

  it('has nothing to say about an empty patch', () => {
    expect(fillPixels(new Uint8ClampedArray(0), red)).toHaveLength(0)
  })
})
