import { describe, expect, it } from 'vitest'
import { PageParseError, parseTranslation, serializeTranslation } from './schema'
import { TRANSLATION_SCHEMA_VERSION } from './types'

const UPRIGHT = { id: 'a', x: 0.5, y: 0.5, groupId: null, lines: ['hi'] }

function raw(label: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: TRANSLATION_SCHEMA_VERSION, labels: [label] })
}

describe('translation rotation', () => {
  it('reads a page written before objects could be turned', () => {
    const parsed = parseTranslation(raw(UPRIGHT))
    expect(parsed.labels[0].rotation).toBeUndefined()
  })

  it('carries a turn through', () => {
    const parsed = parseTranslation(raw({ ...UPRIGHT, rotation: -0.7853981633974483 }))
    expect(parsed.labels[0].rotation).toBeCloseTo(-Math.PI / 4, 12)
  })

  it('refuses a turn that is not a number', () => {
    expect(() => parseTranslation(raw({ ...UPRIGHT, rotation: '45deg' }))).toThrow(PageParseError)
    expect(() => parseTranslation(raw({ ...UPRIGHT, rotation: Number.NaN }))).toThrow(
      PageParseError,
    )
  })

  it('leaves upright labels out of the file rather than writing a zero on each', () => {
    const out = serializeTranslation({
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [{ ...UPRIGHT, rotation: 0 }],
    })
    expect(JSON.parse(out).labels[0]).not.toHaveProperty('rotation')
  })

  it('round trips a turned object', () => {
    const turned = { ...UPRIGHT, rotation: 1.25 }
    const out = serializeTranslation({
      schemaVersion: TRANSLATION_SCHEMA_VERSION,
      labels: [turned],
    })
    expect(parseTranslation(out).labels[0].rotation).toBe(1.25)
  })
})
