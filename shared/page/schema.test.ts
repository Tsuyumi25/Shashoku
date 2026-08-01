import { describe, expect, it } from 'vitest'
import { PageParseError, parseManifest, serializeManifest } from './schema'
import type { ManifestJson, RasterLayerEntry, TextLayerEntry } from './types'
import { MANIFEST_SCHEMA_VERSION } from './types'

const UPRIGHT = {
  kind: 'text',
  id: 'a',
  visible: true,
  locked: false,
  x: 512,
  y: 300,
  groupId: null,
  lines: ['hi'],
}

const PATCH = {
  kind: 'raster',
  id: 'r',
  visible: true,
  locked: false,
  name: '塗白',
  file: 'r.png',
  x: 10,
  y: 20,
  w: 30,
  h: 40,
  alphaLocked: false,
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

describe('a text object stands where it was put', () => {
  it('keeps a position between two pixels, which is what a rasterizer resolves', () => {
    const parsed = firstText(parseManifest(raw({ ...UPRIGHT, x: 512.37, y: 300.5 })))
    expect([parsed.x, parsed.y]).toEqual([512.37, 300.5])
  })

  it('refuses a position that is not a number', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, x: '512' }))).toThrow(PageParseError)
    expect(() => parseManifest(raw({ ...UPRIGHT, y: Number.POSITIVE_INFINITY }))).toThrow(
      PageParseError,
    )
  })

  /**
   * Which point of its frame the position names is derived from the object's
   * alignment now, so a page that still carries the field opens without it.
   */
  it('opens a page that names a point of its own, ignoring the field', () => {
    const parsed = firstText(parseManifest(raw({ ...UPRIGHT, anchor: 'bottom-right' })))
    expect(parsed).not.toHaveProperty('anchor')
  })

  it('writes no such field', () => {
    const out = serializeManifest(manifestWith(UPRIGHT as TextLayerEntry))
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('anchor')
  })
})

describe('the page the positions are measured against', () => {
  it('has no size until somebody has measured one', () => {
    const parsed = parseManifest(raw(UPRIGHT))
    expect(parsed.width).toBeUndefined()
    expect(parsed.height).toBeUndefined()
  })

  it('carries a measured size through', () => {
    const sized = JSON.stringify({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      width: 1668,
      height: 2388,
      readingOrder: ['a'],
      layers: [UPRIGHT],
    })
    const parsed = parseManifest(sized)
    expect([parsed.width, parsed.height]).toEqual([1668, 2388])
  })

  it('round trips a measured size', () => {
    const object = {
      ...UPRIGHT,
      rotation: 0,
      opacity: 1,
      blendMode: 'normal',
    } as TextLayerEntry
    const source = { ...manifestWith(object), width: 800, height: 1200 }
    expect(parseManifest(serializeManifest(source))).toEqual(source)
  })

  it('writes no size for a page nobody has measured', () => {
    const out = serializeManifest(manifestWith(UPRIGHT as TextLayerEntry))
    expect(JSON.parse(out)).not.toHaveProperty('width')
  })

  it('refuses a size no page could have', () => {
    const bad = JSON.stringify({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      width: 0,
      height: 2388,
      readingOrder: ['a'],
      layers: [UPRIGHT],
    })
    expect(() => parseManifest(bad)).toThrow(PageParseError)
  })
})

describe('opacity and blend mode', () => {
  const firstEntry = (m: ManifestJson) => m.layers[0]

  it('reads an entry that names neither as opaque and normal', () => {
    const parsed = firstEntry(parseManifest(raw(UPRIGHT)))
    expect(parsed.opacity).toBe(1)
    expect(parsed.blendMode).toBe('normal')
  })

  // Photoshop's default for a group, and the one that needs no buffer.
  it('reads a folder that names no blend mode as pass-through', () => {
    const folder = { kind: 'group', id: 'g', name: '對白', visible: true, locked: false, children: [] }
    expect(firstEntry(parseManifest(raw(folder, []))).blendMode).toBe('pass-through')
  })

  it('refuses an opacity outside the range', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, opacity: 1.5 }))).toThrow(PageParseError)
    expect(() => parseManifest(raw({ ...UPRIGHT, opacity: -0.1 }))).toThrow(PageParseError)
    expect(() => parseManifest(raw({ ...UPRIGHT, opacity: '50%' }))).toThrow(PageParseError)
  })

  it('refuses a blend mode nothing can draw', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, blendMode: 'divide' }))).toThrow(PageParseError)
  })

  // Pass-through says "no buffer of my own", which only a container can mean.
  it('refuses pass-through on anything that is not a folder', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, blendMode: 'pass-through' }))).toThrow(
      PageParseError,
    )
    expect(() => parseManifest(raw({ ...PATCH, blendMode: 'pass-through' }, []))).toThrow(
      PageParseError,
    )
  })

  it('leaves both out of the file rather than writing a default on every entry', () => {
    const plain = { ...UPRIGHT, rotation: 0, opacity: 1, blendMode: 'normal' }
    const out = serializeManifest(manifestWith(plain as TextLayerEntry))
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('opacity')
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('blendMode')
  })

  it('round trips a faded object', () => {
    const faded = { ...UPRIGHT, rotation: 0, opacity: 0.4, blendMode: 'multiply' }
    const parsed = firstEntry(parseManifest(serializeManifest(manifestWith(faded as TextLayerEntry))))
    expect(parsed.opacity).toBe(0.4)
    expect(parsed.blendMode).toBe('multiply')
  })
})

describe('a raster layer carries its own frame', () => {
  const firstRaster = (m: ManifestJson) => m.layers[0] as RasterLayerEntry

  it('carries the frame through', () => {
    const parsed = firstRaster(parseManifest(raw(PATCH, [])))
    expect([parsed.x, parsed.y, parsed.w, parsed.h]).toEqual([10, 20, 30, 40])
  })

  // A blank layer created by the panel's button, before anything is written to it.
  it('accepts a layer that has no frame yet', () => {
    const blank = { ...PATCH, x: 0, y: 0, w: 0, h: 0 }
    expect(firstRaster(parseManifest(raw(blank, []))).w).toBe(0)
  })

  it('refuses a frame that does not land on whole pixels', () => {
    expect(() => parseManifest(raw({ ...PATCH, x: 10.5 }, []))).toThrow(PageParseError)
  })

  it('refuses a negative size', () => {
    expect(() => parseManifest(raw({ ...PATCH, w: -1 }, []))).toThrow(PageParseError)
  })

  it('refuses a frame it was never given', () => {
    const { w: _w, ...noWidth } = PATCH
    expect(() => parseManifest(raw(noWidth, []))).toThrow(PageParseError)
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
          opacity: 1,
          blendMode: 'pass-through',
          children: [
            {
              ...UPRIGHT,
              rotation: 0,
              opacity: 1,
              blendMode: 'normal',
            } as TextLayerEntry,
            {
              ...UPRIGHT,
              id: 'b',
              rotation: 0,
              opacity: 1,
              blendMode: 'normal',
              lines: ['ゴゴゴ'],
            } as TextLayerEntry,
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

  // The version this one replaces stored a fraction of the raw, which cannot be
  // converted without the page's own size — and this parser has never seen it.
  it('refuses the version before it rather than reading the old unit as the new one', () => {
    const v4 = JSON.stringify({
      schemaVersion: MANIFEST_SCHEMA_VERSION - 1,
      revision: 0,
      readingOrder: ['a'],
      layers: [{ ...UPRIGHT, x: 0.5, y: 0.5 }],
    })
    expect(() => parseManifest(v4)).toThrow(PageParseError)
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
