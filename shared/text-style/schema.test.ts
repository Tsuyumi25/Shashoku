import { describe, expect, it } from 'vitest'
import { parseTextStyle, serializeTextStyle } from './schema'
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
      fontSizePx: 31,
      direction: 'vertical' as const,
      effects: [{ kind: 'stroke' as const, width: 3, color: '#ffffff', position: 'outside' as const }],
    }
    expect(parseTextStyle(serializeTextStyle(style), 'style', fail)).toEqual(style)
  })
})
