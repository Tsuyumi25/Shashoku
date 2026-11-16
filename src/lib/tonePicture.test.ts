import { describe, expect, it } from 'vitest'
import type { ToneEffect } from '@shared/effects/types'
import { screenPixels, type PageGrid } from './tonePicture'

const SIDE = 120
const GRID: PageGrid = { x0: 0.5, y0: 0.5, dx: 1, dy: 1 }
const TONE: ToneEffect = { kind: 'tone', spacing: 8, angle: 45, density: 'image' }

/** A square of one colour, straight RGBA. */
function flat(r: number, g: number, b: number, a: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SIDE * SIDE * 4)
  for (let i = 0; i < out.length; i += 4) out.set([r, g, b, a], i)
  return out
}

function screened(ink: Uint8ClampedArray, tone: ToneEffect = TONE): Uint8ClampedArray {
  const out = ink.slice()
  screenPixels(ink, out, null, SIDE, SIDE, GRID, tone)
  return out
}

function meanAlpha(px: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 3; i < px.length; i += 4) sum += px[i]!
  return sum / (px.length / 4) / 255
}

describe('a picture as screentone film', () => {
  it('lays no ink where it is white, so what is underneath shows', () => {
    expect(meanAlpha(screened(flat(255, 255, 255, 255)))).toBe(0)
  })

  it('lays as much ink as the grey would darken white paper', () => {
    expect(meanAlpha(screened(flat(128, 128, 128, 255)))).toBeCloseTo(0.5, 1)
  })

  it('thins a soft edge into smaller dots instead of fading solid black', () => {
    const edge = screened(flat(0, 0, 0, 77))
    expect(meanAlpha(edge)).toBeCloseTo(0.3, 1)
    const alphas = new Set<number>()
    for (let i = 3; i < edge.length; i += 4) alphas.add(edge[i]!)
    expect(alphas.has(255)).toBe(true)
    expect(alphas.has(0)).toBe(true)
  })

  it('scales a fixed density by the alpha too', () => {
    expect(meanAlpha(screened(flat(255, 255, 255, 128), { ...TONE, density: 60 }))).toBeCloseTo(0.3, 1)
  })
})

describe('a label with its fill screened', () => {
  it('leaves a stroke the fill never reached exactly as it was', () => {
    const whole = flat(255, 255, 255, 255)
    const out = whole.slice()
    screenPixels(flat(0, 0, 0, 0), out, whole, SIDE, SIDE, GRID, TONE)
    expect(out).toEqual(whole)
  })

  it('keeps the part of a stroke that lies over the fill on top of the dots', () => {
    // Half a white stroke plus half a black fill, the two shares summed.
    const fill = flat(0, 0, 0, 128)
    const whole = flat(128, 128, 128, 255)
    const out = whole.slice()
    screenPixels(fill, out, whole, SIDE, SIDE, GRID, TONE)
    let white = 0
    for (let i = 0; i < out.length; i += 4) white += (out[i]! * out[i + 3]!) / 255
    expect(white / (out.length / 4) / 255).toBeCloseTo(0.5, 1)
  })

  it('is only dots where there are no strokes', () => {
    const fill = flat(128, 128, 128, 255)
    const out = fill.slice()
    screenPixels(fill, out, fill, SIDE, SIDE, GRID, TONE)
    expect(meanAlpha(out)).toBeCloseTo(0.5, 1)
    for (let i = 0; i < out.length; i += 4) expect(out[i]).toBe(0)
  })
})
