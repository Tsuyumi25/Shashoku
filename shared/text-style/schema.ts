


import type { TextAlign, TextDirection, TextStyle } from './types'
import { MAX_SCALE_PERCENT, MIN_SCALE_PERCENT } from './types'

type Fail = (message: string) => never

/**
 * Every field of a style, in the order a panel shows them. Anything that walks
 * a style field by field reads this, so adding an eighth field is one edit and
 * not a hunt for the places that enumerated seven.
 */
export const TEXT_STYLE_FIELDS = [
  'fontFamily',
  'fontFace',
  'fontStyleName',
  'fontSizePx',
  'direction',
  'align',
  'color',
  'leadingPercent',
  'weightPx',
  'scaleXPercent',
  'scaleYPercent',
] as const satisfies readonly (keyof TextStyle)[]

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

function parseScale(v: unknown, at: string, fail: Fail): number {
  if (v === undefined) return 100
  if (typeof v !== 'number' || !Number.isFinite(v) || v < MIN_SCALE_PERCENT || v > MAX_SCALE_PERCENT)
    fail(`${at} 必須是 ${MIN_SCALE_PERCENT} 到 ${MAX_SCALE_PERCENT} 之間的數`)
  return v
}

export function parseTextStyle(v: unknown, at: string, fail: Fail): TextStyle {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const {
    fontFamily,
    fontFace,
    fontStyleName,
    fontSizePx,
    direction,
    align,
    color,
    leadingPercent,
    weightPx,
    scaleXPercent,
    scaleYPercent,
  } = v
  // Empty is a value: no family has been chosen yet. It is stored rather than
  // written as some placeholder name because a project file identifies a font
  // by name, and any name put here would be one a reader could go looking
  // for. What draws is the same either way — nothing in the catalogue matches.
  if (typeof fontFamily !== 'string') fail(`${at}.fontFamily 必須是字串`)
  // Required rather than defaulted: a style parsed without them would silently
  // resolve through the family, which is exactly the lottery the field exists
  // to end. Old files are refused by the schema version before reaching here.
  if (typeof fontFace !== 'string') fail(`${at}.fontFace 必須是字串`)
  if (typeof fontStyleName !== 'string') fail(`${at}.fontStyleName 必須是字串`)
  if (typeof fontSizePx !== 'number' || !Number.isFinite(fontSizePx) || fontSizePx <= 0)
    fail(`${at}.fontSizePx 必須是正數`)
  const dir = parseDirection(direction, `${at}.direction`, fail)
  if (typeof color !== 'string' || color.length === 0) fail(`${at}.color 必須是非空字串`)
  if (typeof leadingPercent !== 'number' || !Number.isFinite(leadingPercent) || leadingPercent <= 0)
    fail(`${at}.leadingPercent 必須是正數`)
  // Absent means the face is drawn as it was designed, which is what every
  // file written before this field existed meant.
  if (weightPx !== undefined && (typeof weightPx !== 'number' || !Number.isFinite(weightPx)))
    fail(`${at}.weightPx 必須是有限數`)
  // Absent means the face's own proportions, which is what every file written
  // before characters could be scaled meant.
  const scaleX = parseScale(scaleXPercent, `${at}.scaleXPercent`, fail)
  const scaleY = parseScale(scaleYPercent, `${at}.scaleYPercent`, fail)
  return {
    fontFamily,
    fontFace,
    fontStyleName,
    fontSizePx,
    direction: dir,
    align: align === undefined ? 'start' : parseAlign(align, `${at}.align`, fail),
    color,
    leadingPercent,
    weightPx: weightPx === undefined ? 0 : weightPx,
    scaleXPercent: scaleX,
    scaleYPercent: scaleY,
  }
}


export function serializeTextStyle(s: TextStyle): Record<string, unknown> {
  return {
    fontFamily: s.fontFamily,
    fontFace: s.fontFace,
    fontStyleName: s.fontStyleName,
    fontSizePx: s.fontSizePx,
    direction: s.direction,
    align: s.align,
    color: s.color,
    leadingPercent: s.leadingPercent,
    weightPx: s.weightPx,
    scaleXPercent: s.scaleXPercent,
    scaleYPercent: s.scaleYPercent,
  }
}




