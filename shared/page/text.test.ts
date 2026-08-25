import { describe, expect, it } from 'vitest'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { emptyBody } from './schema'
import { isBlank, linesFor, textOf } from './text'

type Body = Parameters<typeof linesFor>[0]

function entry(over: Partial<Body> = {}): Body {
  return {
    ...emptyBody(DEFAULT_TEXT_STYLE),
    candidates: [],
    chosen: null,
    ...over,
  }
}

const CANDIDATE = { id: 'c1', lines: ['候選一行'] }

describe('linesFor', () => {
  it('reads the object own lines when no slot is filled', () => {
    expect(linesFor(entry({ lines: ['自己打的'] }))).toEqual(['自己打的'])
  })

  it('reads the chosen candidate without touching the own lines', () => {
    const e = entry({ lines: [''], candidates: [CANDIDATE], chosen: 'c1' })
    expect(linesFor(e)).toEqual(['候選一行'])
    expect(e.lines).toEqual([''])
  })

  it('falls back to the own lines when the slot names a candidate the pool lost', () => {
    expect(linesFor(entry({ lines: ['留著'], chosen: 'gone' }))).toEqual(['留著'])
  })
})

describe('textOf', () => {
  it('joins the resolved lines', () => {
    expect(textOf(entry({ lines: ['一', '二'] }))).toBe('一\n二')
  })

  it('reads the chosen candidate', () => {
    expect(textOf(entry({ candidates: [CANDIDATE], chosen: 'c1' }))).toBe('候選一行')
  })
})

describe('isBlank', () => {
  it('is true for an object with nothing anywhere', () => {
    expect(isBlank(entry())).toBe(true)
    expect(isBlank(entry({ lines: ['', ''] }))).toBe(true)
  })

  it('is false for an object with its own text', () => {
    expect(isBlank(entry({ lines: ['有字'] }))).toBe(false)
  })

  /**
   * The state MCP leaves behind when it fills the slot of a blank object: the
   * own lines are still empty, and every display has to read it as translated.
   */
  it('is false when only the chosen candidate has text', () => {
    expect(isBlank(entry({ lines: [''], candidates: [CANDIDATE], chosen: 'c1' }))).toBe(
      false,
    )
  })

  it('is true when the chosen candidate is itself empty', () => {
    const empty = { id: 'c2', lines: [''] }
    expect(isBlank(entry({ lines: ['有字'], candidates: [empty], chosen: 'c2' }))).toBe(true)
  })
})
