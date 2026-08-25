import { describe, expect, it } from 'vitest'
import { isBlank, linesFor, textOf } from './text'

type Entry = Parameters<typeof linesFor>[0]

function entry(over: Partial<Entry> = {}): Entry {
  return { lines: [''], translations: [], translation: null, ...over }
}

const CANDIDATE = { id: 'c1', lines: ['候選一行'] }

describe('linesFor', () => {
  it('reads the object own lines when no slot is filled', () => {
    expect(linesFor(entry({ lines: ['自己打的'] }))).toEqual(['自己打的'])
  })

  it('reads the chosen candidate without touching the own lines', () => {
    const e = entry({ lines: [''], translations: [CANDIDATE], translation: 'c1' })
    expect(linesFor(e)).toEqual(['候選一行'])
    expect(e.lines).toEqual([''])
  })

  it('falls back to the own lines when the slot names a candidate the pool lost', () => {
    expect(linesFor(entry({ lines: ['留著'], translation: 'gone' }))).toEqual(['留著'])
  })
})

describe('textOf', () => {
  it('joins the resolved lines', () => {
    expect(textOf(entry({ lines: ['一', '二'] }))).toBe('一\n二')
  })

  it('reads the chosen candidate', () => {
    expect(textOf(entry({ translations: [CANDIDATE], translation: 'c1' }))).toBe('候選一行')
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
    expect(isBlank(entry({ lines: [''], translations: [CANDIDATE], translation: 'c1' }))).toBe(
      false,
    )
  })

  it('is true when the chosen candidate is itself empty', () => {
    const empty = { id: 'c2', lines: [''] }
    expect(isBlank(entry({ lines: ['有字'], translations: [empty], translation: 'c2' }))).toBe(true)
  })
})
