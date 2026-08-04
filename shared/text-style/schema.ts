


import type {
  StrokeEffect,
  StrokePosition,
  TextAlign,
  TextDirection,
  TextEffect,
  TextStyle,
  TextStyleProvenance,
} from './types'

type Fail = (message: string) => never

/**
 * Every field of a style, in the order a panel shows them. Anything that walks
 * a style field by field reads this, so adding an eighth field is one edit and
 * not a hunt for the places that enumerated seven.
 */
export const TEXT_STYLE_FIELDS = [
  'fontFamily',
  'fontSizePx',
  'direction',
  'align',
  'color',
  'leadingPercent',
  'effects',
] as const satisfies readonly (keyof TextStyle)[]

export type TextStyleField = (typeof TEXT_STYLE_FIELDS)[number]

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseDirection(v: unknown, at: string, fail: Fail): TextDirection {
  if (v === 'horizontal' || v === 'vertical') return v
  fail(`${at} 必須是 'horizontal' | 'vertical'`)
}

function parseAlign(v: unknown, at: string, fail: Fail): TextAlign {
  if (v === 'start' || v === 'center' || v === 'end') return v
  fail(`${at} 必須是 'start' | 'center' | 'end'`)
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

function parseTextEffect(v: unknown, at: string, fail: Fail): TextEffect {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { kind } = v
  if (kind === 'stroke') return parseStrokeEffect(v, at, fail)
  fail(`${at}.kind 未知效果類型 '${String(kind)}'`)
}

function parseEffectsArray(v: unknown, at: string, fail: Fail): TextEffect[] {
  if (!Array.isArray(v)) fail(`${at} 必須是陣列`)
  return v.map((e, i) => parseTextEffect(e, `${at}[${i}]`, fail))
}

function serializeTextEffect(e: TextEffect): Record<string, unknown> {
  if (e.kind === 'stroke') {
    return { kind: 'stroke', width: e.width, color: e.color, position: e.position }
  }
  
  
  throw new Error(`unknown text effect kind: ${(e as { kind: string }).kind}`)
}


export function parseTextStyle(v: unknown, at: string, fail: Fail): TextStyle {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { fontFamily, fontSizePx, direction, align, color, leadingPercent, effects } = v
  // Empty is a value: no family has been chosen yet. It is stored rather than
  // written as some placeholder name because a project file identifies a font
  // by family, and any name put here would be one a reader could go looking
  // for. What draws is the same either way — nothing in the catalogue matches.
  if (typeof fontFamily !== 'string') fail(`${at}.fontFamily 必須是字串`)
  if (typeof fontSizePx !== 'number' || !Number.isFinite(fontSizePx) || fontSizePx <= 0)
    fail(`${at}.fontSizePx 必須是正數`)
  const dir = parseDirection(direction, `${at}.direction`, fail)
  if (typeof color !== 'string' || color.length === 0) fail(`${at}.color 必須是非空字串`)
  if (typeof leadingPercent !== 'number' || !Number.isFinite(leadingPercent) || leadingPercent <= 0)
    fail(`${at}.leadingPercent 必須是正數`)
  const parsedEffects =
    effects === undefined ? [] : parseEffectsArray(effects, `${at}.effects`, fail)
  return {
    fontFamily,
    fontSizePx,
    direction: dir,
    align: align === undefined ? 'start' : parseAlign(align, `${at}.align`, fail),
    color,
    leadingPercent,
    effects: parsedEffects,
  }
}


export function serializeTextStyle(s: TextStyle): Record<string, unknown> {
  return {
    fontFamily: s.fontFamily,
    fontSizePx: s.fontSizePx,
    direction: s.direction,
    align: s.align,
    color: s.color,
    leadingPercent: s.leadingPercent,
    effects: s.effects.map(serializeTextEffect),
  }
}


export function parseTextStyleProvenance(
  v: unknown,
  at: string,
  fail: Fail,
): TextStyleProvenance {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const out: TextStyleProvenance = {}
  for (const field of TEXT_STYLE_FIELDS) {
    const label = v[field]
    if (label === undefined) continue
    if (typeof label !== 'string' || label.length === 0)
      fail(`${at}.${field} 必須是非空字串(批次操作的名稱)`)
    out[field] = label
  }
  return out
}


export function serializeTextStyleProvenance(p: TextStyleProvenance): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of TEXT_STYLE_FIELDS) {
    const label = p[field]
    if (label !== undefined) out[field] = label
  }
  return out
}


