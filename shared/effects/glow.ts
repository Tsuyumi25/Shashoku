import type { GlowEffect, LayerEffect } from './types'

export function glowOf(effects: readonly LayerEffect[]): GlowEffect | null {
  return effects.find((e): e is GlowEffect => e.kind === 'glow') ?? null
}

export function withGlow(effects: readonly LayerEffect[], glow: GlowEffect | null): LayerEffect[] {
  const rest = effects.filter((e) => e.kind !== 'glow')
  return glow === null ? rest : [...rest, glow]
}

/**
 * The halo's size split by its spread: a solid band grown out first, then a
 * blur over the band's edge — Photoshop's "expands the boundaries of the matte
 * prior to blurring". Page pixels.
 */
export function glowShape(glow: GlowEffect): { spread: number; blur: number } {
  const size = Math.max(0, glow.size)
  const solid = Math.min(100, Math.max(0, glow.spread)) / 100
  return { spread: size * solid, blur: size * (1 - solid) }
}

/**
 * How far past the content a halo can still leave a visible pixel, in page
 * pixels. The blur is a Gaussian whose deviation is half of it, and three
 * deviations out the alpha has fallen below a 255th.
 */
export function glowReach(glow: GlowEffect | null): number {
  if (glow === null || glow.size <= 0) return 0
  const { spread, blur } = glowShape(glow)
  return Math.ceil(spread + blur * 1.5) + 1
}
