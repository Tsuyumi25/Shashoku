import { describe, expect, it } from 'vitest'
import { PageParseError, parseManifest, serializeManifest } from './schema'
import type { ManifestJson, TextLayerEntry } from './types'
import { MANIFEST_SCHEMA_VERSION } from './types'

const UPRIGHT = {
  kind: 'text',
  id: 'a',
  visible: true,
  locked: false,
  x: 0.5,
  y: 0.5,
  groupId: null,
  lines: ['hi'],
}

function raw(entry: Record<string, unknown>, readingOrder: string[] = ['a']): string {
  return JSON.stringify({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    readingOrder,
    layers: [entry],
  })
}

function manifestWith(entry: TextLayerEntry): ManifestJson {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    readingOrder: [entry.id],
    layers: [entry],
  }
}

const firstText = (m: ManifestJson): TextLayerEntry => m.layers[0] as TextLayerEntry

describe('text object rotation', () => {
  it('reads a page written before objects could be turned as upright', () => {
    expect(firstText(parseManifest(raw(UPRIGHT))).rotation).toBe(0)
  })

  it('carries a turn through', () => {
    const parsed = parseManifest(raw({ ...UPRIGHT, rotation: -0.7853981633974483 }))
    expect(firstText(parsed).rotation).toBeCloseTo(-Math.PI / 4, 12)
  })

  it('refuses a turn that is not a number', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, rotation: '45deg' }))).toThrow(PageParseError)
    expect(() => parseManifest(raw({ ...UPRIGHT, rotation: Number.NaN }))).toThrow(PageParseError)
  })

  it('leaves upright objects out of the file rather than writing a zero on each', () => {
    const out = serializeManifest(manifestWith({ ...UPRIGHT, rotation: 0 } as TextLayerEntry))
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('rotation')
  })

  it('round trips a turned object', () => {
    const out = serializeManifest(manifestWith({ ...UPRIGHT, rotation: 1.25 } as TextLayerEntry))
    expect(firstText(parseManifest(out)).rotation).toBe(1.25)
  })
})

describe('parseManifest', () => {
  it('round trips a page whole', () => {
    const source: ManifestJson = {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 7,
      readingOrder: ['b', 'a'],
      layers: [
        {
          kind: 'group',
          id: 'g',
          name: '對白',
          visible: true,
          locked: false,
          children: [
            { ...UPRIGHT, rotation: 0 } as TextLayerEntry,
            { ...UPRIGHT, id: 'b', rotation: 0, lines: ['ゴゴゴ'] } as TextLayerEntry,
          ],
        },
      ],
    }
    expect(parseManifest(serializeManifest(source))).toEqual(source)
  })

  it('refuses a page from a version it does not know', () => {
    const older = JSON.stringify({ schemaVersion: 2, revision: 0, layers: [] })
    expect(() => parseManifest(older)).toThrow(PageParseError)
  })

  it('refuses a text object whose group the project does not have', () => {
    const entry = { ...UPRIGHT, groupId: 'g-gone' }
    expect(() => parseManifest(raw(entry), ['g-in'])).toThrow(PageParseError)
  })

  it('refuses a line with a newline inside it, since lines are the breaks', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, lines: ['a\nb'] }))).toThrow(PageParseError)
  })

  // Structure is this layer's whole job: a page whose order has drifted still
  // opens, and repair puts it right.
  it('opens a page whose reading order disagrees with its objects', () => {
    const parsed = parseManifest(raw(UPRIGHT, ['ghost']))
    expect(parsed.readingOrder).toEqual(['ghost'])
  })
})
