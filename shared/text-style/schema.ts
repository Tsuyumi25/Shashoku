// TextStyle 的 parse helpers,shared/project 與 shared/page schema 共用。
// 純函式無 IO。錯誤由呼叫端的 fail() 拋出(這裡收 fail 當 continuation)。

import type { TextDirection, TextStyle } from './types'

type Fail = (message: string) => never

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseDirection(v: unknown, at: string, fail: Fail): TextDirection {
  if (v === 'horizontal' || v === 'vertical') return v
  fail(`${at} 必須是 'horizontal' | 'vertical'`)
}

/** 解析完整 TextStyle(所有欄位必填);給 ProjectJson.defaultStyle / groups[].style 用 */
export function parseTextStyle(v: unknown, at: string, fail: Fail): TextStyle {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { fontFamily, fontSizePx, direction, color, leadingPercent } = v
  if (typeof fontFamily !== 'string' || fontFamily.length === 0) fail(`${at}.fontFamily 必須是非空字串`)
  if (typeof fontSizePx !== 'number' || !Number.isFinite(fontSizePx) || fontSizePx <= 0)
    fail(`${at}.fontSizePx 必須是正數`)
  const dir = parseDirection(direction, `${at}.direction`, fail)
  if (typeof color !== 'string' || color.length === 0) fail(`${at}.color 必須是非空字串`)
  if (typeof leadingPercent !== 'number' || !Number.isFinite(leadingPercent) || leadingPercent <= 0)
    fail(`${at}.leadingPercent 必須是正數`)
  return { fontFamily, fontSizePx, direction: dir, color, leadingPercent }
}

/**
 * 解析 Partial<TextStyle>(每欄位選用,存在則驗、缺則跳過);給 label.styleOverride 用。
 * 空物件 → 空 Partial(合法,代表無覆寫)。
 */
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
  return out
}

/** 完整 TextStyle 序列化(固定 key 順序,配合 project.json git diff 友善) */
export function serializeTextStyle(s: TextStyle): Record<string, unknown> {
  return {
    fontFamily: s.fontFamily,
    fontSizePx: s.fontSizePx,
    direction: s.direction,
    color: s.color,
    leadingPercent: s.leadingPercent,
  }
}

/** Partial 序列化:只寫存在的欄位,order 對齊完整版 */
export function serializePartialTextStyle(s: Partial<TextStyle>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (s.fontFamily !== undefined) out.fontFamily = s.fontFamily
  if (s.fontSizePx !== undefined) out.fontSizePx = s.fontSizePx
  if (s.direction !== undefined) out.direction = s.direction
  if (s.color !== undefined) out.color = s.color
  if (s.leadingPercent !== undefined) out.leadingPercent = s.leadingPercent
  return out
}
