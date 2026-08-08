import { describe, expect, it } from 'vitest'
import type { TextStyle } from './types'
import { TEXT_STYLE_FIELDS } from './schema'
import { CARRIED_WITH_FAMILY, SKELETON_FIELDS, SKIN_FIELDS } from './fields'

describe('the field split', () => {
  /**
   * A field nobody filed would be silently dropped from every statistic drawn
   * over a style, which is the one failure this split cannot signal by itself.
   */
  it('accounts for every field of a style exactly once', () => {
    const filed = [...SKELETON_FIELDS, ...SKIN_FIELDS, ...CARRIED_WITH_FAMILY]
    expect([...filed].sort()).toEqual([...TEXT_STYLE_FIELDS].sort())
    expect(new Set(filed).size).toBe(filed.length)
  })

  it('keeps the skeleton in the order a panel shows the fields', () => {
    const order = (fields: readonly (keyof TextStyle)[]) =>
      fields.map((f) => TEXT_STYLE_FIELDS.indexOf(f))
    expect(order(SKELETON_FIELDS)).toEqual([...order(SKELETON_FIELDS)].sort((a, b) => a - b))
  })

  it('leaves the family in the skeleton and the two names it carries out of it', () => {
    expect(SKELETON_FIELDS).toContain('fontFamily')
    expect(CARRIED_WITH_FAMILY).toEqual(['fontFace', 'fontStyleName'])
  })
})
