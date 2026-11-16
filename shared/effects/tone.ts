import type { LayerEffect, ToneEffect } from './types'

export function toneOf(effects: readonly LayerEffect[]): ToneEffect | null {
  return effects.find((e): e is ToneEffect => e.kind === 'tone') ?? null
}

export function withTone(effects: readonly LayerEffect[], tone: ToneEffect | null): LayerEffect[] {
  const rest = effects.filter((e) => e.kind !== 'tone')
  return tone === null ? rest : [...rest, tone]
}

/**
 * How much of the pixel centred on page point (`x`, `y`) is black ink, 0–1,
 * when the tone wants `density` of the cell covered there.
 *
 * Dots on a grid turned by the angle, one centred on every grid point, with
 * the area the density asks for. Round up to 30%, then squaring off until at
 * half they are diamonds meeting at their corners — a checkerboard, the same
 * pattern either way round. Past half it is the white between them that is
 * the dot, centred in each cell, so the pattern runs on through the middle
 * without a seam. The edge is anti-aliased across one page pixel.
 */
export function toneInk(x: number, y: number, density: number, spacing: number, cos: number, sin: number): number {
  if (density <= 0) return 0
  if (density >= 1) return 1
  const inverted = density > 0.5
  const area = inverted ? 1 - density : density
  const shift = inverted ? 0.5 : 0
  const u = (x * cos + y * sin) / spacing + shift
  const v = (-x * sin + y * cos) / spacing + shift
  const a = Math.abs(u - Math.round(u))
  const b = Math.abs(v - Math.round(v))
  const n = area <= 0.3 ? 2 : 2 - (area - 0.3) / 0.2
  const r = Math.sqrt(area / unitBallArea(n))
  const an = a ** n
  const bn = b ** n
  const d = (an + bn) ** (1 / n)
  const slope = d === 0 ? 1 : Math.hypot(an / a || 0, bn / b || 0) / d ** (n - 1)
  const inside = clamp01(((r - d) / slope) * spacing + 0.5)
  return inverted ? 1 - inside : inside
}

/** Area of the ball |x|ⁿ + |y|ⁿ ≤ 1. */
function unitBallArea(n: number): number {
  return (4 * gamma(1 + 1 / n) ** 2) / gamma(1 + 2 / n)
}

/** Γ for the 1–3 the ball area asks about, by Lanczos (g = 7, nine terms). */
function gamma(z: number): number {
  const x = z - 1
  let sum = LANCZOS[0]!
  for (let i = 1; i < LANCZOS.length; i++) sum += LANCZOS[i]! / (x + i)
  const t = x + 7.5
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * sum
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
