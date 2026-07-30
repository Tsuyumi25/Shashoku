import { describe, expect, it } from 'vitest'
import { pixelHexAt, rgbToHex } from './color'

describe('rgbToHex', () => {
  it('pads every channel to two digits', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff')
    expect(rgbToHex(1, 16, 255)).toBe('#0110ff')
  })
})

describe('pixelHexAt', () => {
  /** 2×2: white, red / green, blue — all opaque. */
  const pixels = new Uint8ClampedArray([
    255, 255, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
  ])

  it('reads the pixel the point is inside of', () => {
    expect(pixelHexAt(pixels, 2, 2, 0, 0)).toBe('#ffffff')
    expect(pixelHexAt(pixels, 2, 2, 1, 0)).toBe('#ff0000')
    expect(pixelHexAt(pixels, 2, 2, 0, 1)).toBe('#00ff00')
    expect(pixelHexAt(pixels, 2, 2, 1, 1)).toBe('#0000ff')
  })

  it('stays on a pixel across the whole of it rather than rounding to its neighbour', () => {
    expect(pixelHexAt(pixels, 2, 2, 0.9, 0.9)).toBe('#ffffff')
    expect(pixelHexAt(pixels, 2, 2, 1.01, 0)).toBe('#ff0000')
  })

  it('ignores alpha', () => {
    const faded = new Uint8ClampedArray([255, 0, 0, 0])
    expect(pixelHexAt(faded, 1, 1, 0, 0)).toBe('#ff0000')
  })

  it('answers nothing off the page', () => {
    expect(pixelHexAt(pixels, 2, 2, -0.5, 0)).toBeNull()
    expect(pixelHexAt(pixels, 2, 2, 0, 2)).toBeNull()
    expect(pixelHexAt(pixels, 2, 2, 2, 0)).toBeNull()
  })
})
