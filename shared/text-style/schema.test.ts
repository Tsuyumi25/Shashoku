import { describe, expect, it } from 'vitest'
import {
  parseTextStyle,
  parseTextStyleProvenance,
  serializeTextStyle,
  serializeTextStyleProvenance,
} from './schema'
import { DEFAULT_TEXT_STYLE } from './types'

const fail = (message: string): never => {
  throw new Error(message)
}

describe('parseTextStyle', () => {
  /**
   * Projects written before `renderScale` was dropped still carry it. Parsing
   * reads named keys and never rejects the rest, which is what lets a field
   * retire without a migration — a strict schema would break every one of those
   * projects the day it landed.
   */
  it('reads a style an older version wrote, ignoring the field it no longer has', () => {
    const older = { ...serializeTextStyle(DEFAULT_TEXT_STYLE), renderScale: 4 }
    expect(parseTextStyle(older, 'style', fail)).toEqual(DEFAULT_TEXT_STYLE)
  })

  it('round-trips a style it wrote itself', () => {
    const style = {
      ...DEFAULT_TEXT_STYLE,
      fontFamily: 'Some Face',
      fontSizePx: 31,
      direction: 'vertical' as const,
      effects: [{ kind: 'stroke' as const, width: 3, color: '#ffffff', position: 'outside' as const }],
    }
    expect(parseTextStyle(serializeTextStyle(style), 'style', fail)).toEqual(style)
  })

  /**
   * A project that has not been given a default font stores no family rather
   * than a placeholder name, since anything written here is a name a reader
   * would go looking for in the catalogue.
   */
  it('accepts a style with no family chosen', () => {
    const style = serializeTextStyle({ ...DEFAULT_TEXT_STYLE, fontFamily: '' })
    expect(parseTextStyle(style, 'style', fail).fontFamily).toBe('')
  })

  it('still refuses a family that is not a string', () => {
    const style = { ...serializeTextStyle(DEFAULT_TEXT_STYLE), fontFamily: 42 }
    expect(() => parseTextStyle(style, 'style', fail)).toThrow()
  })

  /**
   * A project written before alignment existed keeps the look it had: every
   * line began where the text begins, which is what `start` names.
   */
  it('reads a style that names no alignment as starting where the text does', () => {
    const older = serializeTextStyle(DEFAULT_TEXT_STYLE)
    delete older.align
    expect(parseTextStyle(older, 'style', fail).align).toBe('start')
  })

  it('round-trips an alignment', () => {
    const style = { ...DEFAULT_TEXT_STYLE, align: 'end' as const }
    expect(parseTextStyle(serializeTextStyle(style), 'style', fail).align).toBe('end')
  })

  /**
   * Named after the direction the text runs rather than after a side, so one
   * value means the same thing set horizontally and vertically.
   */
  it('refuses an alignment named after an edge', () => {
    const style = { ...serializeTextStyle(DEFAULT_TEXT_STYLE), align: 'left' }
    expect(() => parseTextStyle(style, 'style', fail)).toThrow()
  })
})

describe('parseTextStyleProvenance', () => {
  it('round-trips the labels it was given', () => {
    const provenance = { fontFamily: '換字體', effects: '套用描邊' }
    const written = serializeTextStyleProvenance(provenance)
    expect(parseTextStyleProvenance(written, 'provenance', fail)).toEqual(provenance)
  })

  /** Absent is "the user's own hand", which is not something to store. */
  it('leaves a field nobody batched out', () => {
    expect(parseTextStyleProvenance({}, 'provenance', fail)).not.toHaveProperty('color')
  })

  it('refuses a label that is not a string', () => {
    expect(() => parseTextStyleProvenance({ color: 7 }, 'provenance', fail)).toThrow()
  })
})
