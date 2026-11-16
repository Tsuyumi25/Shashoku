import { describe, expect, it } from 'vitest'
import type { GlowEffect, LayerEffect } from './types'
import { glowReach, withGlow } from './glow'
import { parseEffects, serializeEffects } from './schema'

const STROKE: LayerEffect = { kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' }
const GLOW: GlowEffect = { kind: 'glow', size: 8, spread: 40, color: '#ff000080', blendMode: 'multiply' }

const fail = (message: string): never => {
  throw new Error(message)
}

describe('glow on disk', () => {
  it('comes back from the file as it went in, beside the strokes', () => {
    const effects: LayerEffect[] = [STROKE, GLOW]
    const read = parseEffects(JSON.parse(JSON.stringify(serializeEffects(effects))), 'effects', fail)
    expect(read).toEqual(effects)
  })

  it('refuses a second halo rather than drawing one of them', () => {
    expect(() => parseEffects([GLOW, { ...GLOW, size: 3 }], 'effects', fail)).toThrow(/最多只能有一個光暈/)
  })

  it('refuses a negative size', () => {
    expect(() => parseEffects([{ ...GLOW, size: -1 }], 'effects', fail)).toThrow(/size/)
  })

  it('refuses a spread past a hundred percent', () => {
    expect(() => parseEffects([{ ...GLOW, spread: 101 }], 'effects', fail)).toThrow(/spread/)
  })

  it('refuses pass-through, which a halo has no contents to do', () => {
    expect(() => parseEffects([{ ...GLOW, blendMode: 'pass-through' }], 'effects', fail)).toThrow(/blendMode/)
  })
})

describe('glowReach', () => {
  /** The spread part reaches its full width; only the blurred part trails off past it. */
  it('reaches as far as the size when fully spread, and further once it blurs', () => {
    expect(glowReach({ ...GLOW, size: 10, spread: 100 })).toBe(11)
    expect(glowReach({ ...GLOW, size: 10, spread: 0 })).toBe(16)
  })
})

describe('withGlow', () => {
  it('replaces the halo and leaves the strokes in their order', () => {
    const second: LayerEffect = { ...STROKE, color: '#000000' }
    const out = withGlow([STROKE, GLOW, second], { ...GLOW, size: 20 })
    expect(out).toEqual([STROKE, second, { ...GLOW, size: 20 }])
  })

  it('takes the halo off without touching anything else', () => {
    expect(withGlow([STROKE, GLOW], null)).toEqual([STROKE])
  })
})
