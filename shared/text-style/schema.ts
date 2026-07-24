


import type {
  StrokeEffect,
  StrokePosition,
  TextDirection,
  TextEffect,
  TextStyle,
} from './types'

type Fail = (message: string) => never

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseDirection(v: unknown, at: string, fail: Fail): TextDirection {
  if (v === 'horizontal' || v === 'vertical') return v
  fail(`${at} 必須是 'horizontal' | 'vertical'`)
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
  const { fontFamily, fontSizePx, direction, color, leadingPercent, renderScale, effects } = v
  if (typeof fontFamily !== 'string' || fontFamily.length === 0) fail(`${at}.fontFamily 必須是非空字串`)
  if (typeof fontSizePx !== 'number' || !Number.isFinite(fontSizePx) || fontSizePx <= 0)
    fail(`${at}.fontSizePx 必須是正數`)
  const dir = parseDirection(direction, `${at}.direction`, fail)
  if (typeof color !== 'string' || color.length === 0) fail(`${at}.color 必須是非空字串`)
  if (typeof leadingPercent !== 'number' || !Number.isFinite(leadingPercent) || leadingPercent <= 0)
    fail(`${at}.leadingPercent 必須是正數`)
  
  let parsedRenderScale: number
  if (renderScale === undefined) {
    parsedRenderScale = 1
  } else {
    if (typeof renderScale !== 'number' || !Number.isFinite(renderScale) || renderScale <= 0)
      fail(`${at}.renderScale 必須是正數`)
    parsedRenderScale = renderScale
  }
  const parsedEffects =
    effects === undefined ? [] : parseEffectsArray(effects, `${at}.effects`, fail)
  return {
    fontFamily,
    fontSizePx,
    direction: dir,
    color,
    leadingPercent,
    renderScale: parsedRenderScale,
    effects: parsedEffects,
  }
}


export function parsePartialTextStyle(v: unknown, at: string, fail: Fail): Partial<TextStyle> {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const out: Partial<TextStyle> = {}
  if (v.fontFamily !== undefined) {
    if (typeof v.fontFamily !== 'string' || v.fontFamily.length === 0)
      fail(`${at}.fontFamily 必須是非空字串`)
    out.fontFamily = v.fontFamily
  }
  if (v.fontSizePx !== undefined) {
    if (typeof v.fontSizePx !== 'number' || !Number.isFinite(v.fontSizePx) || v.fontSizePx <= 0)
      fail(`${at}.fontSizePx 必須是正數`)
    out.fontSizePx = v.fontSizePx
  }
  if (v.direction !== undefined) out.direction = parseDirection(v.direction, `${at}.direction`, fail)
  if (v.color !== undefined) {
    if (typeof v.color !== 'string' || v.color.length === 0) fail(`${at}.color 必須是非空字串`)
    out.color = v.color
  }
  if (v.leadingPercent !== undefined) {
    if (typeof v.leadingPercent !== 'number' || !Number.isFinite(v.leadingPercent) || v.leadingPercent <= 0)
      fail(`${at}.leadingPercent 必須是正數`)
    out.leadingPercent = v.leadingPercent
  }
  if (v.renderScale !== undefined) {
    if (typeof v.renderScale !== 'number' || !Number.isFinite(v.renderScale) || v.renderScale <= 0)
      fail(`${at}.renderScale 必須是正數`)
    out.renderScale = v.renderScale
  }
  if (v.effects !== undefined) {
    out.effects = parseEffectsArray(v.effects, `${at}.effects`, fail)
  }
  return out
}


export function serializeTextStyle(s: TextStyle): Record<string, unknown> {
  return {
    fontFamily: s.fontFamily,
    fontSizePx: s.fontSizePx,
    direction: s.direction,
    color: s.color,
    leadingPercent: s.leadingPercent,
    renderScale: s.renderScale,
    effects: s.effects.map(serializeTextEffect),
  }
}


export function serializePartialTextStyle(s: Partial<TextStyle>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (s.fontFamily !== undefined) out.fontFamily = s.fontFamily
  if (s.fontSizePx !== undefined) out.fontSizePx = s.fontSizePx
  if (s.direction !== undefined) out.direction = s.direction
  if (s.color !== undefined) out.color = s.color
  if (s.leadingPercent !== undefined) out.leadingPercent = s.leadingPercent
  if (s.renderScale !== undefined) out.renderScale = s.renderScale
  if (s.effects !== undefined) out.effects = s.effects.map(serializeTextEffect)
  return out
}
