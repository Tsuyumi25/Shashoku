import { BLEND_MODE_ALLOWLIST, PASS_THROUGH } from '../page/types'
import type { GlowEffect, LayerEffect, StrokeEffect, StrokePosition, ToneEffect } from './types'

type Fail = (message: string) => never

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseStrokePosition(v: unknown, at: string, fail: Fail): StrokePosition {
  if (v === 'inside' || v === 'center' || v === 'outside') return v
  fail(`${at} 必須是 'inside' | 'center' | 'outside'`)
}

function parseStrokeEffect(v: Record<string, unknown>, at: string, fail: Fail): StrokeEffect {
  const { width, color, position, joins } = v
  // Zero is a stroke turned down to nothing, kept for its colour and position.
  if (typeof width !== 'number' || !Number.isFinite(width) || width < 0)
    fail(`${at}.width 必須是非負數`)
  if (typeof color !== 'string' || color.length === 0)
    fail(`${at}.color 必須是非空字串`)
  if (joins !== undefined && joins !== false) fail(`${at}.joins 只能是 false 或不寫`)
  const stroke: StrokeEffect = {
    kind: 'stroke',
    width,
    color,
    position: parseStrokePosition(position, `${at}.position`, fail),
  }
  if (joins === false) stroke.joins = false
  return stroke
}

function parseGlowEffect(v: Record<string, unknown>, at: string, fail: Fail): GlowEffect {
  const { size, color, spread = 0, blendMode = 'screen' } = v
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) fail(`${at}.size 必須是非負數`)
  if (typeof color !== 'string' || color.length === 0) fail(`${at}.color 必須是非空字串`)
  if (typeof spread !== 'number' || !(spread >= 0 && spread <= 100)) fail(`${at}.spread 必須介於 0 到 100`)
  if (
    typeof blendMode !== 'string' ||
    blendMode === PASS_THROUGH ||
    !(BLEND_MODE_ALLOWLIST as readonly string[]).includes(blendMode)
  )
    fail(`${at}.blendMode 必須是穿透以外的混合模式`)
  return { kind: 'glow', size, spread, color, blendMode }
}

function parseToneEffect(v: Record<string, unknown>, at: string, fail: Fail): ToneEffect {
  const { spacing, angle, density } = v
  if (typeof spacing !== 'number' || !Number.isFinite(spacing) || spacing <= 0) fail(`${at}.spacing 必須是正數`)
  if (typeof angle !== 'number' || !Number.isFinite(angle)) fail(`${at}.angle 必須是數字`)
  if (density !== 'image' && !(typeof density === 'number' && density >= 0 && density <= 100))
    fail(`${at}.density 必須是 'image' 或 0 到 100 之間的數字`)
  return { kind: 'tone', spacing, angle, density }
}

function parseLayerEffect(v: unknown, at: string, fail: Fail): LayerEffect {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { kind } = v
  if (kind === 'stroke') return parseStrokeEffect(v, at, fail)
  if (kind === 'glow') return parseGlowEffect(v, at, fail)
  if (kind === 'tone') return parseToneEffect(v, at, fail)
  fail(`${at}.kind 未知效果類型 '${String(kind)}'`)
}

/** Absent is the ordinary state of a node, and stays legal for ever. */
export function parseEffects(v: unknown, at: string, fail: Fail): LayerEffect[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${at} 必須是陣列`)
  const effects = v.map((e, i) => parseLayerEffect(e, `${at}[${i}]`, fail))
  if (effects.filter((e) => e.kind === 'glow').length > 1) fail(`${at} 最多只能有一個光暈`)
  if (effects.filter((e) => e.kind === 'tone').length > 1) fail(`${at} 最多只能有一個網點`)
  return effects
}

function serializeLayerEffect(e: LayerEffect): Record<string, unknown> {
  if (e.kind === 'stroke') {
    const out: Record<string, unknown> = { kind: 'stroke', width: e.width, color: e.color, position: e.position }
    if (e.joins === false) out.joins = false
    return out
  }
  if (e.kind === 'glow')
    return { kind: 'glow', size: e.size, spread: e.spread, color: e.color, blendMode: e.blendMode }
  if (e.kind === 'tone') return { kind: 'tone', spacing: e.spacing, angle: e.angle, density: e.density }
  throw new Error(`unknown layer effect kind: ${(e as { kind: string }).kind}`)
}

export function serializeEffects(effects: readonly LayerEffect[]): Record<string, unknown>[] {
  return effects.map(serializeLayerEffect)
}
