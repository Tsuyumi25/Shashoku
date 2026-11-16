import { describe, expect, it } from 'vitest'
import type { LayerEffect, ToneEffect } from './types'
import { toneInk, withTone } from './tone'
import { parseEffects, serializeEffects } from './schema'

const GLOW: LayerEffect = { kind: 'glow', size: 8, spread: 0, color: '#ffffff', blendMode: 'screen' }
const TONE: ToneEffect = { kind: 'tone', spacing: 10, angle: 45, density: 'image' }

const fail = (message: string): never => {
  throw new Error(message)
}

/** Mean ink over a square of page pixels, the way a pixel grid would see it. */
function meanInk(density: number, spacing: number, angle: number, side = 200): number {
  const rad = (angle * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  let sum = 0
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) sum += toneInk(x + 0.5, y + 0.5, density, spacing, cos, sin)
  return sum / (side * side)
}

describe('tone on disk', () => {
  it('comes back from the file as it went in, with either kind of density', () => {
    const effects: LayerEffect[] = [GLOW, TONE]
    const fixed: LayerEffect[] = [{ ...TONE, density: 30 }]
    for (const list of [effects, fixed]) {
      const read = parseEffects(JSON.parse(JSON.stringify(serializeEffects(list))), 'effects', fail)
      expect(read).toEqual(list)
    }
  })

  it('refuses a second screentone rather than drawing one of them', () => {
    expect(() => parseEffects([TONE, { ...TONE, angle: 0 }], 'effects', fail)).toThrow(/最多只能有一個網點/)
  })

  it('refuses spacing that is not a positive number of pixels', () => {
    expect(() => parseEffects([{ ...TONE, spacing: 0 }], 'effects', fail)).toThrow(/spacing/)
  })

  it('refuses a density past a hundred percent', () => {
    expect(() => parseEffects([{ ...TONE, density: 101 }], 'effects', fail)).toThrow(/density/)
  })

  it('replaces the one that is there instead of adding another', () => {
    const once = withTone([GLOW], TONE)
    expect(withTone(once, { ...TONE, spacing: 6 })).toEqual([GLOW, { ...TONE, spacing: 6 }])
    expect(withTone(once, null)).toEqual([GLOW])
  })
})

describe('how much ink the dots lay', () => {
  it('covers as much of the paper as the density asks, either side of the middle', () => {
    for (const density of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      expect(meanInk(density, 10, 45)).toBeCloseTo(density, 1)
    }
  })

  it('keeps getting darker through the middle, where dots turn into holes', () => {
    const steps = [0.4, 0.45, 0.5, 0.55, 0.6].map((d) => meanInk(d, 10, 30))
    for (let i = 1; i < steps.length; i++) expect(steps[i]).toBeGreaterThan(steps[i - 1]!)
  })

  it('leaves white paper at nothing and lays solid black at full', () => {
    expect(meanInk(0, 10, 45, 40)).toBe(0)
    expect(meanInk(1, 10, 45, 40)).toBe(1)
  })
})
