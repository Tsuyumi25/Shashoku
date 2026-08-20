import { describe, expect, it } from 'vitest'
import { maskPixels } from '@/lib/selection/fill'

/** One opaque pixel per mask byte, in a colour worth watching for. */
function opaque(count: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i += 1) out.set([255, 0, 0, 255], i * 4)
  return out
}

describe('maskPixels', () => {
  it('scales the alpha by the coverage', () => {
    const rgba = opaque(4)
    maskPixels(rgba, new Uint8ClampedArray([0, 128, 255, 64]))
    expect([...rgba.slice(4, 8)]).toEqual([255, 0, 0, 128])
    expect([...rgba.slice(8, 12)]).toEqual([255, 0, 0, 255])
    expect([...rgba.slice(12, 16)]).toEqual([255, 0, 0, 64])
  })

  /**
   * A soft edge is the whole reason the mask is 8-bit rather than a set of
   * pixels, and clipping it here would put a jagged patch on the page.
   */
  it('keeps a feathered edge rather than clipping it to on or off', () => {
    const rgba = opaque(1)
    maskPixels(rgba, new Uint8ClampedArray([200]))
    expect(rgba[3]).toBe(200)
  })

  /**
   * A transparent red drags the white beside it pink the moment anything
   * resamples, and baking a transform takes exactly that path.
   */
  it('takes the colour with the alpha it took to nothing', () => {
    const rgba = opaque(1)
    maskPixels(rgba, new Uint8ClampedArray([0]))
    expect([...rgba]).toEqual([0, 0, 0, 0])
  })

  it('takes what was already transparent no further', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 0])
    maskPixels(rgba, new Uint8ClampedArray([255]))
    expect([...rgba]).toEqual([0, 0, 0, 0])
  })

  it('has nothing to say about an empty patch', () => {
    const rgba = new Uint8ClampedArray(0)
    expect(() => maskPixels(rgba, new Uint8ClampedArray(0))).not.toThrow()
  })
})
