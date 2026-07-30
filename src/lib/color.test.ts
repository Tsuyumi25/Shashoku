import { describe, expect, it } from 'vitest'
import { hexToRgb, pixelHexAt, rgbToHex } from './color'

describe('rgbToHex', () => {
  it('pads every channel to two digits', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff')
    expect(rgbToHex(1, 16, 255)).toBe('#0110ff')
  })
})

describe('hexToRgb', () => {
  it('reads the long form', () => {
    expect(hexToRgb('#0110ff')).toEqual({ r: 1, g: 16, b: 255 })
  })

  it('reads the short form by doubling each digit', () => {
    expect(hexToRgb('#f0a')).toEqual({ r: 255, g: 0, b: 170 })
  })

  it('round trips whatever rgbToHex wrote', () => {
    expect(hexToRgb(rgbToHex(9, 200, 37))).toEqual({ r: 9, g: 200, b: 37 })
  })

  it('refuses anything else rather than standing in for it', () => {
    expect(hexToRgb('red')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
    expect(hexToRgb('#gg0000')).toBeNull()
    expect(hexToRgb('')).toBeNull()
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
