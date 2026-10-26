/**
 * The markup a text body stores, and the plain text it reads as.
 *
 * ⭐ The stored string IS the code: every `lines` entry and every candidate
 * piece holds markup. Everything that draws, exports, searches or compares
 * reads `plainOf` instead, and every caret that moves between the two sides
 * goes through `codeCaret` / `plainCaret`.
 *
 * ⚠️ Greedy by construction: every string parses and there is no error state.
 * A tag that does not close runs to the end, a closing tag matching nothing is
 * dropped, a malformed attribute is ignored. Text the user typed can never be
 * refused — what is stored is what they wrote.
 */

export interface MarkupFields {
  size?: { scale: number } | { px: number }
  color?: string
  weight?: { add: number } | { px: number }
  upright?: boolean
}

export interface MarkupTag {
  name: string | null
  fields: MarkupFields
  /** The opening tag's own text. */
  codeStart: number
  codeEnd: number
  /** The plain range the tag covers. */
  plainStart: number
  plainEnd: number
  /** The closing tag's own text, or null when the tag runs to the end. */
  closeStart: number | null
  closeEnd: number | null
}

export interface Markup {
  code: string
  plain: string
  /** codeAt[i] = code offset of plain char i (its first code unit, e.g. the '&' of &lt;); codeAt[plain.length] = code.length */
  codeAt: number[]
  /** In opening order, which for tags covering the same character is outermost → innermost. */
  tags: MarkupTag[]
}

/** Plain UTF-16 offsets. Only stretches some tag changes, adjacent equals merged. */
export interface ResolvedSpan {
  start: number
  end: number
  sizePx: number
  color: string
  weightPx: number
  upright: boolean
}

export interface SpanBase {
  fontSizePx: number
  color: string
  weightPx: number
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function sizeValue(v: string): MarkupFields['size'] | undefined {
  const first = v.charCodeAt(0)
  // ×, x, X, * all mean "times the object's own size".
  if (first === 0xd7 || v[0] === 'x' || v[0] === 'X' || v[0] === '*') {
    const scale = Number(v.slice(1))
    return Number.isFinite(scale) && scale > 0 ? { scale } : undefined
  }
  const px = Number(v.endsWith('px') ? v.slice(0, -2) : v)
  return Number.isFinite(px) && px > 0 ? { px } : undefined
}

function weightValue(v: string): MarkupFields['weight'] | undefined {
  const body = v.endsWith('px') ? v.slice(0, -2) : v
  const n = Number(body)
  if (!Number.isFinite(n) || body.length === 0) return undefined
  if (body[0] === '+' || body[0] === '-') return { add: n }
  return n >= 0 ? { px: n } : undefined
}

/** Whether the token was attribute-shaped at all; an unknown or malformed one is ignored, never a name. */
function readToken(token: string, into: MarkupFields): boolean {
  if (token === 'upright') {
    into.upright = true
    return true
  }
  const eq = token.indexOf('=')
  if (eq < 0) return false
  const key = token.slice(0, eq)
  const value = token.slice(eq + 1)
  if (key === 'size') {
    const size = sizeValue(value)
    if (size !== undefined) into.size = size
  } else if (key === 'color') {
    if (HEX_COLOR.test(value)) into.color = value
  } else if (key === 'weight') {
    const weight = weightValue(value)
    if (weight !== undefined) into.weight = weight
  }
  return true
}

function hasFields(fields: MarkupFields): boolean {
  return (
    fields.size !== undefined ||
    fields.color !== undefined ||
    fields.weight !== undefined ||
    fields.upright === true
  )
}

function tokensOf(inner: string): string[] {
  const out: string[] = []
  for (const token of inner.split(/\s+/)) if (token.length > 0) out.push(token)
  return out
}

/** The attribute keys a `</x>` may name, so `</size>` can close a tag nobody named. */
function keysOf(fields: MarkupFields): string[] {
  const out: string[] = []
  if (fields.size !== undefined) out.push('size')
  if (fields.color !== undefined) out.push('color')
  if (fields.weight !== undefined) out.push('weight')
  if (fields.upright === true) out.push('upright')
  return out
}

function fieldTokens(fields: MarkupFields): string[] {
  const out: string[] = []
  const { size, weight } = fields
  if (size !== undefined) out.push('scale' in size ? `size=×${size.scale}` : `size=${size.px}px`)
  if (fields.color !== undefined) out.push(`color=${fields.color}`)
  if (weight !== undefined)
    out.push('add' in weight ? `weight=${weight.add >= 0 ? '+' : ''}${weight.add}` : `weight=${weight.px}px`)
  if (fields.upright === true) out.push('upright')
  return out
}

/** How many code units plain char `i` took, read back from where its code starts. */
function codeWidth(code: string, at: number): number {
  if (code.charCodeAt(at) !== 0x26) return 1
  if (code.startsWith('&lt;', at)) return 4
  if (code.startsWith('&amp;', at)) return 5
  return 1
}

export function parseMarkup(code: string): Markup {
  const plain: string[] = []
  const codeAt: number[] = []
  const tags: MarkupTag[] = []
  const open: MarkupTag[] = []
  // A bare `<x>` reuses the attributes of the first `<x …>` in the same string.
  const named = new Map<string, MarkupFields>()

  let i = 0
  const keep = (ch: string, at: number): void => {
    plain.push(ch)
    codeAt.push(at)
  }

  while (i < code.length) {
    const ch = code[i]
    if (ch === '&') {
      if (code.startsWith('&lt;', i)) {
        keep('<', i)
        i += 4
        continue
      }
      if (code.startsWith('&amp;', i)) {
        keep('&', i)
        i += 5
        continue
      }
      keep('&', i)
      i += 1
      continue
    }
    if (ch === '<') {
      const gt = code.indexOf('>', i + 1)
      if (gt < 0) {
        keep('<', i)
        i += 1
        continue
      }
      const inner = code.slice(i + 1, gt)
      if (inner[0] === '/') {
        const want = inner.slice(1).trim()
        let found = -1
        for (let k = open.length - 1; k >= 0; k--) {
          const tag = open[k]
          if (want.length === 0 || tag.name === want || keysOf(tag.fields).includes(want)) {
            found = k
            break
          }
        }
        if (found >= 0) {
          const tag = open[found]
          tag.plainEnd = plain.length
          tag.closeStart = i
          tag.closeEnd = gt + 1
          open.splice(found, 1)
        }
        i = gt + 1
        continue
      }
      const fields: MarkupFields = {}
      let name: string | null = null
      for (const token of tokensOf(inner)) {
        if (!readToken(token, fields) && name === null) name = token
      }
      let resolved = fields
      if (!hasFields(fields) && name !== null) resolved = named.get(name) ?? fields
      if (name !== null && !named.has(name)) named.set(name, resolved)
      const tag: MarkupTag = {
        name,
        fields: resolved,
        codeStart: i,
        codeEnd: gt + 1,
        plainStart: plain.length,
        plainEnd: plain.length,
        closeStart: null,
        closeEnd: null,
      }
      tags.push(tag)
      open.push(tag)
      i = gt + 1
      continue
    }
    keep(ch, i)
    i += 1
  }

  for (const tag of open) tag.plainEnd = plain.length
  codeAt.push(code.length)
  return { code, plain: plain.join(''), codeAt, tags }
}

export function plainOf(code: string): string {
  if (!code.includes('<') && !code.includes('&')) return code
  let out = ''
  let kept = 0
  let i = 0
  while (i < code.length) {
    const ch = code[i]
    if (ch === '&') {
      if (code.startsWith('&lt;', i)) {
        out += code.slice(kept, i) + '<'
        i += 4
      } else if (code.startsWith('&amp;', i)) {
        out += code.slice(kept, i) + '&'
        i += 5
      } else {
        i += 1
        continue
      }
      kept = i
      continue
    }
    if (ch === '<') {
      const gt = code.indexOf('>', i + 1)
      if (gt < 0) break
      out += code.slice(kept, i)
      i = gt + 1
      kept = i
      continue
    }
    i += 1
  }
  return out + code.slice(kept)
}

export function escapeText(plain: string): string {
  if (!plain.includes('&') && !plain.includes('<')) return plain
  return plain.replace(/&/g, '&amp;').replace(/</g, '&lt;')
}

export function resolveSpans(m: Markup, base: SpanBase): ResolvedSpan[] {
  const marks = new Set<number>()
  for (const tag of m.tags) {
    if (tag.plainEnd <= tag.plainStart || !hasFields(tag.fields)) continue
    marks.add(tag.plainStart)
    marks.add(tag.plainEnd)
  }
  if (marks.size === 0) return []
  const bounds = [...marks].sort((a, b) => a - b)

  const out: ResolvedSpan[] = []
  for (let b = 0; b + 1 < bounds.length; b++) {
    const start = bounds[b]
    const end = bounds[b + 1]
    let sizePx = base.fontSizePx
    let color = base.color
    let weightPx = base.weightPx
    let upright = false
    for (const tag of m.tags) {
      if (tag.plainStart > start || tag.plainEnd < end) continue
      const { size, weight } = tag.fields
      if (size !== undefined) sizePx = 'scale' in size ? sizePx * size.scale : size.px
      if (tag.fields.color !== undefined) color = tag.fields.color
      if (weight !== undefined) weightPx = 'add' in weight ? weightPx + weight.add : weight.px
      if (tag.fields.upright === true) upright = true
    }
    if (sizePx === base.fontSizePx && color === base.color && weightPx === base.weightPx && !upright)
      continue
    const last = out[out.length - 1]
    if (
      last !== undefined &&
      last.end === start &&
      last.sizePx === sizePx &&
      last.color === color &&
      last.weightPx === weightPx &&
      last.upright === upright
    )
      last.end = end
    else out.push({ start, end, sizePx, color, weightPx, upright })
  }
  return out
}

/** plain caret → code caret: right after the code of plain char i-1, so typing continues that char's style. */
export function codeCaret(m: Markup, plainIndex: number): number {
  const i = plainIndex < 0 ? 0 : plainIndex > m.plain.length ? m.plain.length : plainIndex
  if (i === 0) return m.codeAt[0]
  const start = m.codeAt[i - 1]
  return start + codeWidth(m.code, start)
}

/**
 * plain selection → code selection, holding only the words: a selection starts
 * at the first selected character's code and ends right after the last one's,
 * so no tag on either side of the words is ever inside it. An empty selection
 * is a caret and lands as `codeCaret` does.
 */
export function codeSelection(m: Markup, start: number, end: number): { start: number; end: number } {
  const clamp = (i: number) => (i < 0 ? 0 : i > m.plain.length ? m.plain.length : i)
  const lo = clamp(Math.min(start, end))
  const hi = clamp(Math.max(start, end))
  if (lo === hi) {
    const at = codeCaret(m, lo)
    return { start: at, end: at }
  }
  const from = m.codeAt[lo]
  const last = m.codeAt[hi - 1]
  const to = last + codeWidth(m.code, last)
  return start <= end ? { start: from, end: to } : { start: to, end: from }
}

/** code caret → plain caret: how many plain chars start before it, so a caret inside a tag freezes. */
export function plainCaret(m: Markup, codeIndex: number): number {
  const c = codeIndex < 0 ? 0 : codeIndex > m.code.length ? m.code.length : codeIndex
  let lo = 0
  let hi = m.plain.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (m.codeAt[mid] < c) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * An edit made on the plain text, carried into the code: the changed stretch of
 * plain characters loses its code and the new text is escaped in at the caret,
 * while every tag inside the stretch stays where it was.
 */
export function applyPlainEdit(code: string, newPlain: string): string {
  const m = parseMarkup(code)
  const old = m.plain
  if (old === newPlain) return code

  const shortest = Math.min(old.length, newPlain.length)
  let head = 0
  while (head < shortest && old[head] === newPlain[head]) head++
  let tail = 0
  while (
    tail < shortest - head &&
    old[old.length - 1 - tail] === newPlain[newPlain.length - 1 - tail]
  )
    tail++

  const from = head
  const to = old.length - tail
  const caret = codeCaret(m, head)
  const parts: string[] = []
  let at = 0
  if (caret > at) parts.push(code.slice(at, caret))
  at = caret
  parts.push(escapeText(newPlain.slice(head, newPlain.length - tail)))
  for (let i = from; i < to; i++) {
    const start = m.codeAt[i]
    if (start > at) parts.push(code.slice(at, start))
    at = start + codeWidth(code, start)
  }
  parts.push(code.slice(at))
  return parts.join('')
}

/** The name a `</…>` should carry to close `<attrs>` again. */
function closerFor(attrs: string): string {
  const tokens = tokensOf(attrs)
  for (const token of tokens) {
    if (token === 'upright') return 'upright'
    const eq = token.indexOf('=')
    if (eq > 0) return token.slice(0, eq)
  }
  return tokens[0] ?? ''
}

export function wrapCode(
  code: string,
  start: number,
  end: number,
  attrs: string,
): { code: string; start: number; end: number } {
  const from = Math.max(0, Math.min(start, code.length))
  const to = Math.max(from, Math.min(end, code.length))
  const opening = `<${attrs}>`
  const closing = `</${closerFor(attrs)}>`
  return {
    code: code.slice(0, from) + opening + code.slice(from, to) + closing + code.slice(to),
    start: from + opening.length,
    end: to + opening.length,
  }
}

export function unwrapPlainRange(code: string, start: number, end: number): string {
  const m = parseMarkup(code)
  const cuts: [number, number][] = []
  for (const tag of m.tags) {
    if (tag.plainStart < start || tag.plainEnd > end) continue
    cuts.push([tag.codeStart, tag.codeEnd])
    if (tag.closeStart !== null && tag.closeEnd !== null) cuts.push([tag.closeStart, tag.closeEnd])
  }
  if (cuts.length === 0) return code
  cuts.sort((a, b) => a[0] - b[0])
  let out = ''
  let at = 0
  for (const [from, to] of cuts) {
    if (from > at) out += code.slice(at, from)
    at = Math.max(at, to)
  }
  return out + code.slice(at)
}

/** A tag's opening text, written out in full when its own text only borrowed a name. */
function openingTextOf(m: Markup, tag: MarkupTag): string {
  const own = m.code.slice(tag.codeStart, tag.codeEnd)
  if (!hasFields(tag.fields)) return own
  const borrowed: MarkupFields = {}
  for (const token of tokensOf(own.slice(1, -1))) readToken(token, borrowed)
  if (hasFields(borrowed)) return own
  const parts = tag.name === null ? [] : [tag.name]
  return `<${[...parts, ...fieldTokens(tag.fields)].join(' ')}>`
}

/**
 * Cut the code at plain offsets. A tag still open where a cut falls is closed
 * at the end of one piece and opened again at the start of the next, so every
 * piece reads exactly as that stretch did before the cut.
 */
export function splitCode(code: string, plainCuts: readonly number[]): string[] {
  const m = parseMarkup(code)
  const limit = m.plain.length
  const cuts = plainCuts
    .map((c) => (c < 0 ? 0 : c > limit ? limit : c))
    .sort((a, b) => a - b)
  const count = cuts.length + 1
  const starts = [0, ...cuts]
  const ends = [...cuts, limit]

  const pieceStartingAt = (plainIndex: number): number => {
    let k = count - 1
    while (k > 0 && starts[k] > plainIndex) k--
    return k
  }
  const pieceEndingAt = (plainIndex: number): number => {
    let k = 0
    while (k < count - 1 && ends[k] < plainIndex) k++
    return k
  }

  type Token = { at: number; piece: number; text: string; tag: MarkupTag | null; closing: boolean }
  const tokens: Token[] = []
  for (let i = 0; i < limit; i++) {
    const start = m.codeAt[i]
    const width = codeWidth(code, start)
    tokens.push({
      at: start,
      piece: pieceStartingAt(i),
      text: code.slice(start, start + width),
      tag: null,
      closing: false,
    })
  }
  const opensIn = new Map<MarkupTag, number>()
  const closesIn = new Map<MarkupTag, number>()
  for (const tag of m.tags) {
    const openPiece = pieceStartingAt(tag.plainStart)
    const closePiece = pieceEndingAt(tag.plainEnd)
    opensIn.set(tag, openPiece)
    closesIn.set(tag, closePiece)
    tokens.push({
      at: tag.codeStart,
      piece: openPiece,
      text: openingTextOf(m, tag),
      tag,
      closing: false,
    })
    if (tag.closeStart !== null && tag.closeEnd !== null)
      tokens.push({
        at: tag.closeStart,
        piece: closePiece,
        text: code.slice(tag.closeStart, tag.closeEnd),
        tag,
        closing: true,
      })
  }
  tokens.sort((a, b) => a.at - b.at)

  const out: string[] = []
  for (let k = 0; k < count; k++) {
    const carriedIn = m.tags.filter((t) => (opensIn.get(t) ?? 0) < k && (closesIn.get(t) ?? 0) >= k)
    const carriedOut = m.tags.filter(
      (t) => (opensIn.get(t) ?? 0) <= k && (closesIn.get(t) ?? 0) > k,
    )
    let piece = carriedIn.map((t) => openingTextOf(m, t)).join('')
    for (const token of tokens) if (token.piece === k) piece += token.text
    out.push(piece + '</>'.repeat(carriedOut.length))
  }
  return out
}
