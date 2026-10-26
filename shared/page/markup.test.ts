import { describe, expect, it } from 'vitest'
import {
  applyPlainEdit,
  codeCaret,
  codeSelection,
  escapeText,
  parseMarkup,
  plainCaret,
  plainOf,
  resolveSpans,
  splitCode,
  unwrapPlainRange,
  wrapCode,
  type ResolvedSpan,
} from './markup'

const BASE = { fontSizePx: 40, color: '#000000', weightPx: 0 }

/** What every plain character of a code string is set in, one entry per character. */
function styles(code: string): string[] {
  const m = parseMarkup(code)
  const spans = resolveSpans(m, BASE)
  const out = m.plain.split('').map(() => `${BASE.fontSizePx}|${BASE.color}|${BASE.weightPx}|false`)
  for (const s of spans)
    for (let i = s.start; i < s.end; i++)
      out[i] = `${s.sizePx}|${s.color}|${s.weightPx}|${s.upright}`
  return out
}

describe('parsing', () => {
  it('reads plain text as itself', () => {
    expect(plainOf('轟隆')).toBe('轟隆')
    expect(parseMarkup('轟隆').tags).toEqual([])
  })

  it('turns the two escapes back and leaves every other & alone', () => {
    expect(plainOf('&lt;b&gt; &amp; Q&A')).toBe('<b&gt; & Q&A')
    expect(escapeText('<b> & Q&A')).toBe('&lt;b> &amp; Q&amp;A')
    expect(plainOf(escapeText('a<b>&c'))).toBe('a<b>&c')
  })

  it('leaves a < with no later > as text', () => {
    expect(plainOf('1 < 2')).toBe('1 < 2')
    expect(plainOf('a <b')).toBe('a <b')
  })

  it('eats a < that does find a >, however little sense it makes', () => {
    expect(plainOf('1 <2 and 3> 4')).toBe('1  4')
  })

  it('takes the first token that is not an attribute as the name', () => {
    const [tag] = parseMarkup('<big size=×1.3 color=#ff0000>x</big>').tags
    expect(tag.name).toBe('big')
    expect(tag.fields).toEqual({ size: { scale: 1.3 }, color: '#ff0000' })
  })

  it('ignores an attribute it cannot read instead of refusing the string', () => {
    const [tag] = parseMarkup('<size=huge color=red weight=? upright>x</>').tags
    expect(tag.name).toBe(null)
    expect(tag.fields).toEqual({ upright: true })
  })

  it('lets a bare named tag borrow the first earlier tag of that name', () => {
    const m = parseMarkup('<em size=×2>a</em>b<em>c</em>')
    expect(m.tags[1].fields).toEqual({ size: { scale: 2 } })
    expect(m.plain).toBe('abc')
  })

  it('does not let a name borrow from a tag that comes after it', () => {
    const m = parseMarkup('<em>a</em><em size=×2>b</em>')
    expect(m.tags[0].fields).toEqual({})
    expect(m.tags[1].fields).toEqual({ size: { scale: 2 } })
  })

  it('closes by attribute key as well as by name', () => {
    const m = parseMarkup('<size=×2>ab</size>c')
    expect(m.tags[0].plainEnd).toBe(2)
    expect(m.plain).toBe('abc')
  })

  it('drops a closing tag that matches nothing rather than showing it', () => {
    expect(plainOf('a</b>b')).toBe('ab')
    expect(parseMarkup('a</b>b').tags).toEqual([])
  })

  it('runs an unclosed tag to the end', () => {
    const [tag] = parseMarkup('a<b weight=+1>cd').tags
    expect(tag.plainStart).toBe(1)
    expect(tag.plainEnd).toBe(3)
    expect(tag.closeStart).toBe(null)
  })

  it('lets a tag span a line break', () => {
    expect(styles('a<b weight=+1>b\nc</b>d')).toEqual([
      '40|#000000|0|false',
      '40|#000000|1|false',
      '40|#000000|1|false',
      '40|#000000|1|false',
      '40|#000000|0|false',
    ])
  })

  it('keeps both of two crossing tags over the stretch each covers', () => {
    const m = parseMarkup('<a color=#ff0000>12<b weight=+2>34</a>56</b>')
    expect(m.plain).toBe('123456')
    expect(m.tags[0].plainEnd).toBe(4)
    expect(m.tags[1].plainEnd).toBe(6)
    expect(styles('<a color=#ff0000>12<b weight=+2>34</a>56</b>')).toEqual([
      '40|#ff0000|0|false',
      '40|#ff0000|0|false',
      '40|#ff0000|2|false',
      '40|#ff0000|2|false',
      '40|#000000|2|false',
      '40|#000000|2|false',
    ])
  })
})

describe('resolving a style', () => {
  it('says nothing about text no tag reaches', () => {
    expect(resolveSpans(parseMarkup('abc'), BASE)).toEqual([])
    expect(resolveSpans(parseMarkup('<b>abc</b>'), BASE)).toEqual([])
  })

  it('multiplies a relative size and adds a relative weight, innermost last', () => {
    const spans = resolveSpans(parseMarkup('<size=×2 weight=+1>a<size=×0.5 weight=+2>b</>c</>'), BASE)
    expect(spans).toEqual<ResolvedSpan[]>([
      { start: 0, end: 1, sizePx: 80, color: '#000000', weightPx: 1, upright: false },
      { start: 1, end: 2, sizePx: 40, color: '#000000', weightPx: 3, upright: false },
      { start: 2, end: 3, sizePx: 80, color: '#000000', weightPx: 1, upright: false },
    ])
  })

  it('lets an absolute value replace what it is nested in', () => {
    const spans = resolveSpans(parseMarkup('<size=×2>a<size=52px>b</size></size>'), BASE)
    expect(spans[1]).toEqual({
      start: 1,
      end: 2,
      sizePx: 52,
      color: '#000000',
      weightPx: 0,
      upright: false,
    })
  })

  it('merges stretches that read the same', () => {
    expect(resolveSpans(parseMarkup('<b color=#ff0000>ab</b><b>cd</b>'), BASE)).toEqual([
      { start: 0, end: 4, sizePx: 40, color: '#ff0000', weightPx: 0, upright: false },
    ])
  })
})

describe('the two carets', () => {
  const CODE = 'ab<b weight=+1>cd</b>ef'
  const m = parseMarkup(CODE)

  it('puts a plain caret right after the code of the character before it', () => {
    expect(codeCaret(m, 0)).toBe(0)
    expect(codeCaret(m, 2)).toBe(2)
    expect(codeCaret(m, 3)).toBe(16)
    expect(codeCaret(m, 6)).toBe(CODE.length)
  })

  it('counts an escape as the one character it is', () => {
    const esc = parseMarkup('a&amp;b')
    expect(esc.plain).toBe('a&b')
    expect(esc.codeAt).toEqual([0, 1, 6, 7])
    expect(codeCaret(esc, 2)).toBe(6)
  })

  it('freezes a code caret standing inside a tag', () => {
    expect(plainCaret(m, 2)).toBe(2)
    expect(plainCaret(m, 5)).toBe(2)
    expect(plainCaret(m, 15)).toBe(2)
    expect(plainCaret(m, 16)).toBe(3)
    expect(plainCaret(m, 19)).toBe(4)
  })

  it('reads a plain caret back as itself', () => {
    for (let i = 0; i <= m.plain.length; i++) expect(plainCaret(m, codeCaret(m, i))).toBe(i)
  })
})

describe('an edit made on the plain text', () => {
  it('escapes what was typed', () => {
    expect(applyPlainEdit('ab', 'a<&b')).toBe('a&lt;&amp;b')
  })

  it('keeps the tags of a stretch it deletes', () => {
    expect(applyPlainEdit('<b weight=+1>ab</b>cd', 'cd')).toBe('<b weight=+1></b>cd')
    expect(applyPlainEdit('a<b weight=+1>bc</b>d', 'ad')).toBe('a<b weight=+1></b>d')
  })

  it('types into the tag the character before it was in', () => {
    expect(applyPlainEdit('<b weight=+1>ab</b>cd', 'abXcd')).toBe('<b weight=+1>abX</b>cd')
  })

  it('leaves what nobody touched alone', () => {
    expect(applyPlainEdit('<b weight=+1>ab</b>', 'ab')).toBe('<b weight=+1>ab</b>')
    expect(applyPlainEdit('&lt;x&gt;', '<x&gt;')).toBe('&lt;x&gt;')
  })

  it('replaces a stretch in the middle', () => {
    expect(applyPlainEdit('abcd', 'aXYd')).toBe('aXYd')
    expect(applyPlainEdit('a&amp;d', 'aXd')).toBe('aXd')
  })
})

describe('wrapping and clearing', () => {
  it('closes with the first attribute key it was given', () => {
    expect(wrapCode('abcd', 1, 3, 'weight=+1')).toEqual({
      code: 'a<weight=+1>bc</weight>d',
      start: 12,
      end: 14,
    })
  })

  it('closes with the name when the attributes are nameless', () => {
    expect(wrapCode('ab', 0, 2, 'em').code).toBe('<em>ab</em>')
    expect(wrapCode('ab', 0, 2, 'upright').code).toBe('<upright>ab</upright>')
  })

  it('wraps a stretch that already holds a tag', () => {
    const w = wrapCode('a<b weight=+1>bc</b>d', 1, 20, 'color=#ff0000')
    expect(w.code).toBe('a<color=#ff0000><b weight=+1>bc</b></color>d')
    expect(plainOf(w.code)).toBe('abcd')
  })

  it('clears every tag the plain range holds', () => {
    expect(unwrapPlainRange('<b weight=+1>ab</b>cd', 0, 2)).toBe('abcd')
    expect(unwrapPlainRange('a<b weight=+1>b</b>c', 0, 3)).toBe('abc')
  })

  it('leaves a tag reaching outside the range alone', () => {
    expect(unwrapPlainRange('<b weight=+1>abc</b>', 1, 2)).toBe('<b weight=+1>abc</b>')
  })

  it('clears the inner of two nested tags without touching the outer', () => {
    expect(unwrapPlainRange('<a color=#ff0000>1<b weight=+1>2</b>3</a>', 1, 2)).toBe(
      '<a color=#ff0000>123</a>',
    )
  })
})

describe('cutting the code into pieces', () => {
  /** Every piece reads as the stretch it was cut from, set the same way. */
  function equivalent(code: string, cuts: number[]): void {
    const pieces = splitCode(code, cuts)
    expect(pieces.length).toBe(cuts.length + 1)
    expect(pieces.map(plainOf).join('')).toBe(plainOf(code))
    expect(pieces.flatMap(styles)).toEqual(styles(code))
  }

  it('cuts plain text', () => {
    expect(splitCode('abcd', [2])).toEqual(['ab', 'cd'])
  })

  it('closes a tag the cut falls inside and opens it again', () => {
    expect(splitCode('<b weight=+1>abcd</b>', [2])).toEqual([
      '<b weight=+1>ab</>',
      '<b weight=+1>cd</b>',
    ])
    equivalent('<b weight=+1>abcd</b>', [2])
  })

  it('leaves a tag that ends at the cut in the piece before it', () => {
    expect(splitCode('<b weight=+1>ab</b>cd', [2])).toEqual(['<b weight=+1>ab</b>', 'cd'])
  })

  it('leaves a tag that opens at the cut in the piece after it', () => {
    expect(splitCode('ab<b weight=+1>cd</b>', [2])).toEqual(['ab', '<b weight=+1>cd</b>'])
  })

  it('writes out a borrowed name in full, since the tag it borrowed from stays behind', () => {
    const pieces = splitCode('<em size=×2>ab</em>cd<em>ef</em>', [4])
    expect(pieces[1]).toBe('<em size=×2>ef</em>')
    equivalent('<em size=×2>ab</em>cd<em>ef</em>', [4])
  })

  it('carries nested and crossing tags through several cuts', () => {
    equivalent('<a color=#ff0000>12<b weight=+2>34</a>56</b>78', [1, 3, 5, 7])
    equivalent('a&amp;<size=×2>b&lt;c</size>d', [1, 2, 4])
  })

  it('cuts at the very edges without losing anything', () => {
    equivalent('<b weight=+1>ab</b>', [0, 2])
  })
})

describe('a selection made on the words', () => {
  it('holds the words and none of the tags around them', () => {
    const m = parseMarkup('咦<upright>!?</upright>')
    expect(codeSelection(m, 1, 3)).toEqual({ start: 10, end: 12 })
    expect(m.code.slice(10, 12)).toBe('!?')
  })

  it('keeps the tags between the words it runs across', () => {
    const m = parseMarkup('a<b>c</b>d')
    const at = codeSelection(m, 0, 3)
    expect(m.code.slice(at.start, at.end)).toBe('a<b>c</b>d')
  })

  it('covers a whole escape as one character', () => {
    const m = parseMarkup('x&lt;y')
    const at = codeSelection(m, 1, 2)
    expect(m.code.slice(at.start, at.end)).toBe('&lt;')
  })

  it('keeps the direction it was dragged in', () => {
    const m = parseMarkup('咦<upright>!?</upright>')
    expect(codeSelection(m, 3, 1)).toEqual({ start: 12, end: 10 })
  })

  it('lands an empty selection where typing would continue the previous character', () => {
    const m = parseMarkup('咦<upright>!?</upright>')
    expect(codeSelection(m, 3, 3)).toEqual({ start: 12, end: 12 })
  })
})
