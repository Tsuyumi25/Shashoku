import type { LayerEffect, StrokeEffect, StrokePosition } from './types'

type Fail = (message: string) => never

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseStrokePosition(v: unknown, at: string, fail: Fail): StrokePosition {
  if (v === 'inside' || v === 'center' || v === 'outside') return v
  fail(`${at} 必須是 'inside' | 'center' | 'outside'`)
}

function parseStrokeEffect(v: Record<string, unknown>, at: string, fail: Fail): StrokeEffect {
  const { width, color, position } = v
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)
    fail(`${at}.width 必須是正數`)
  if (typeof color !== 'string' || color.length === 0)
    fail(`${at}.color 必須是非空字串`)
  return {
    kind: 'stroke',
    width,
    color,
    position: parseStrokePosition(position, `${at}.position`, fail),
  }
}

function parseLayerEffect(v: unknown, at: string, fail: Fail): LayerEffect {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { kind } = v
  if (kind === 'stroke') return parseStrokeEffect(v, at, fail)
  fail(`${at}.kind 未知效果類型 '${String(kind)}'`)
}

/** Absent is the ordinary state of a node, and stays legal for ever. */
export function parseEffects(v: unknown, at: string, fail: Fail): LayerEffect[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${at} 必須是陣列`)
  return v.map((e, i) => parseLayerEffect(e, `${at}[${i}]`, fail))
}

function serializeLayerEffect(e: LayerEffect): Record<string, unknown> {
  if (e.kind === 'stroke') {
    return { kind: 'stroke', width: e.width, color: e.color, position: e.position }
  }
  throw new Error(`unknown layer effect kind: ${(e as { kind: string }).kind}`)
}

export function serializeEffects(effects: readonly LayerEffect[]): Record<string, unknown>[] {
  return effects.map(serializeLayerEffect)
}
