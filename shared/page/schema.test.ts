import { describe, expect, it } from 'vitest'
import {
  PageParseError,
  parseManifest,
  parseOcr,
  serializeLayers,
  serializeManifest,
  serializeOcr,
} from './schema'
import type { ManifestJson, OcrJson, RasterLayerEntry, TextLayerEntry } from './types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'

const UPRIGHT = {
  kind: 'text',
  id: 'a',
  visible: true,
  locked: false,
  x: 512,
  y: 300,
  tags: [],
  lines: ['hi'],
  source: { hash: null, by: 'auto' },
  ownSource: '',
  style: DEFAULT_TEXT_STYLE,
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
    name: 'p',
    width: 1200,
    height: 1700,
    readingOrder,
    layers: [entry],
  })
}

function manifestWith(entry: TextLayerEntry): ManifestJson {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    readingOrder: [entry.id],
    readingEdges: [],
    layers: [entry],
  }
}

const firstText = (m: ManifestJson): TextLayerEntry => m.layers[0] as TextLayerEntry

/** `UPRIGHT` as the parser hands it back, for the tests that write one out. */
function textEntry(extra: Partial<TextLayerEntry> = {}): TextLayerEntry {
  return {
    ...(UPRIGHT as unknown as TextLayerEntry),
    rotation: 0,
    opacity: 1,
    blendMode: 'normal',
    translations: [],
    translation: null,
    ...extra,
  }
}

describe('the translation candidates', () => {
  const two = [
    { id: 't1', lines: ['妳終於來了'] },
    { id: 't2', lines: ['你可算是來了'], human: true },
  ]

  it('reads a page written before objects had translations as having none', () => {
    const parsed = firstText(parseManifest(raw(UPRIGHT)))
    expect(parsed.translations).toEqual([])
    expect(parsed.translation).toBeNull()
  })

  it('round trips the pool and the slot', () => {
    const entry = textEntry({ translations: two, translation: 't2' })
    expect(parseManifest(serializeManifest(manifestWith(entry)))).toEqual(manifestWith(entry))
  })

  it('writes neither key for an object nobody has translated', () => {
    const out = JSON.parse(serializeManifest(manifestWith(textEntry())))
    expect(out.layers[0]).not.toHaveProperty('translations')
    expect(out.layers[0]).not.toHaveProperty('translation')
  })

  it('opens a slot naming a candidate that is not there as empty', () => {
    const parsed = firstText(
      parseManifest(raw({ ...UPRIGHT, translations: two, translation: 'gone' })),
    )
    expect(parsed.translation).toBeNull()
    expect(parsed.lines).toEqual(['hi'])
  })

  it('refuses two candidates answering to one id', () => {
    const same = [two[0], { id: 't1', lines: ['別的'] }]
    expect(() => parseManifest(raw({ ...UPRIGHT, translations: same }))).toThrow(PageParseError)
  })

  it('refuses a line with a newline inside it, as on the object itself', () => {
    const bad = [{ id: 't1', lines: ['a\nb'] }]
    expect(() => parseManifest(raw({ ...UPRIGHT, translations: bad }))).toThrow(PageParseError)
  })

  it('round trips who proposed a candidate, and refuses an empty name', () => {
    const signed = [{ id: 't1', lines: ['妳終於來了'], source: 'claude-code 2.1.219' }]
    const entry = textEntry({ translations: signed })
    expect(parseManifest(serializeManifest(manifestWith(entry)))).toEqual(manifestWith(entry))
    const blank = [{ id: 't1', lines: ['妳終於來了'], source: '' }]
    expect(() => parseManifest(raw({ ...UPRIGHT, translations: blank }))).toThrow(PageParseError)
  })

  /**
   * Two objects reading the same way are the same picture. What the list is
   * holding behind the one in the slot moves nothing, and a thumbnail thrown
   * away over it is a page of compositing paid for nothing.
   */
  it('identifies the drawn page by what the slot resolves to', () => {
    const held = textEntry({ translations: two, translation: 't1' })
    const typed = textEntry({ lines: two[0].lines })
    expect(serializeLayers([held])).toBe(serializeLayers([typed]))
  })

  it('tells apart two objects reading differently out of one pool', () => {
    const first = textEntry({ translations: two, translation: 't1' })
    const second = textEntry({ translations: two, translation: 't2' })
    expect(serializeLayers([first])).not.toBe(serializeLayers([second]))
  })
})

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
    const out = serializeManifest(manifestWith(textEntry()))
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('rotation')
  })

  it('round trips a turned object', () => {
    const out = serializeManifest(manifestWith(textEntry({ rotation: 1.25 })))
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
    const out = serializeManifest(manifestWith(textEntry()))
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('anchor')
  })
})

describe('the page the positions are measured against', () => {
  /**
   * Required, not discovered. Every position on the page is in page pixels, and
   * there is no image underneath to measure instead — the base map is an
   * ordinary layer that can be hidden, moved or deleted.
   */
  it('refuses a page that does not say how big it is', () => {
    const { width: _w, height: _h, ...sizeless } = JSON.parse(raw(UPRIGHT))
    expect(() => parseManifest(JSON.stringify(sizeless))).toThrow(PageParseError)
  })

  it('carries the size through', () => {
    const parsed = parseManifest(raw(UPRIGHT))
    expect([parsed.width, parsed.height]).toEqual([1200, 1700])
  })

  it('round trips a size', () => {
    const source = { ...manifestWith(textEntry()), width: 800, height: 1200 }
    expect(parseManifest(serializeManifest(source))).toEqual(source)
  })

  it('always writes one', () => {
    const out = JSON.parse(serializeManifest(manifestWith(textEntry())))
    expect([out.width, out.height]).toEqual([1200, 1700])
  })

  it('refuses a size no page could have', () => {
    const bad = { ...JSON.parse(raw(UPRIGHT)), width: 0 }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(PageParseError)
  })
})

describe("the page's name", () => {
  it('carries it through and writes it back', () => {
    expect(parseManifest(raw(UPRIGHT)).name).toBe('p')
    expect(JSON.parse(serializeManifest(manifestWith(textEntry()))).name).toBe('p')
  })

  /**
   * A page with no name has nothing to show in a list, and there is no source
   * filename left to fall back on — the page left that behind when it was made.
   */
  it('refuses a page with no name', () => {
    const { name: _n, ...nameless } = JSON.parse(raw(UPRIGHT))
    expect(() => parseManifest(JSON.stringify(nameless))).toThrow(PageParseError)
  })

  it('refuses an empty one', () => {
    const bad = { ...JSON.parse(raw(UPRIGHT)), name: '' }
    expect(() => parseManifest(JSON.stringify(bad))).toThrow(PageParseError)
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
    const out = serializeManifest(manifestWith(textEntry()))
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('opacity')
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('blendMode')
  })

  it('round trips a faded object', () => {
    const faded = textEntry({ opacity: 0.4, blendMode: 'multiply' })
    const parsed = firstEntry(parseManifest(serializeManifest(manifestWith(faded))))
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
      name: 'p',
      width: 1200,
      height: 1700,
      readingOrder: ['b', 'a'],
      readingEdges: [{ from: 'b', to: 'a' }],
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
            textEntry(),
            textEntry({ id: 'b', lines: ['ゴゴゴ'] }),
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
      name: 'p',
      width: 1200,
      height: 1700,
      readingOrder: ['a'],
      layers: [{ ...UPRIGHT, x: 0.5, y: 0.5 }],
    })
    expect(() => parseManifest(v4)).toThrow(PageParseError)
  })

  /**
   * The registry is advisory, so a name it has never heard is data the user
   * typed rather than a dangling reference — refusing the page would lose it.
   */
  it('opens a page carrying a tag no registry names', () => {
    const parsed = firstText(parseManifest(raw({ ...UPRIGHT, tags: ['角色/ゆみ'] })))
    expect(parsed.tags).toEqual(['角色/ゆみ'])
  })

  it('refuses a tag that is not a non-empty string', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, tags: [7] }))).toThrow(PageParseError)
    expect(() => parseManifest(raw({ ...UPRIGHT, tags: ['  '] }))).toThrow(PageParseError)
  })

  /**
   * `parseTextEntry` and `serializeLayerEntry` are two pieces of hand-written
   * code that happen to agree; the types cannot check that they do. Nothing
   * downstream would notice if they stopped — a set that came back reordered
   * or with a duplicate restored still typechecks, and only the group-by-value
   * view would show it, as drift that is not there.
   */
  it('writes a tag set in one canonical order and reads it back the same', () => {
    const messy = { ...UPRIGHT, tags: ['心聲', '框内', '心聲', ' 框内 '] }
    const written = JSON.parse(serializeManifest(parseManifest(raw(messy))))
    expect(written.layers[0].tags).toEqual(['心聲', '框内'])

    const reordered = { ...UPRIGHT, tags: ['框内', '心聲'] }
    expect(serializeManifest(parseManifest(raw(reordered)))).toBe(
      serializeManifest(parseManifest(raw(messy))),
    )
  })

  it('round trips an object carrying tags and a style of its own', () => {
    const marked = textEntry({
      tags: ['心聲', '框内'],
      style: { ...DEFAULT_TEXT_STYLE, fontSizePx: 48 },
    })
    expect(parseManifest(serializeManifest(manifestWith(marked)))).toEqual(manifestWith(marked))
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

describe('the lines drawn between objects', () => {
  function withEdges(edges: unknown): string {
    return JSON.stringify({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      readingOrder: ['a', 'b'],
      readingEdges: edges,
      layers: [UPRIGHT, { ...UPRIGHT, id: 'b' }],
    })
  }

  // A page nobody has drawn on is the model's ordinary starting state, not a
  // page missing something.
  it('reads a page with no lines on it as a page with no lines on it', () => {
    expect(parseManifest(raw(UPRIGHT)).readingEdges).toEqual([])
  })

  it('carries a line through', () => {
    expect(parseManifest(withEdges([{ from: 'a', to: 'b' }])).readingEdges).toEqual([
      { from: 'a', to: 'b' },
    ])
  })

  it('refuses an object pointed at itself, which says nothing', () => {
    expect(() => parseManifest(withEdges([{ from: 'a', to: 'a' }]))).toThrow(PageParseError)
  })

  it('refuses an end that names nothing', () => {
    expect(() => parseManifest(withEdges([{ from: 'a', to: '' }]))).toThrow(PageParseError)
    expect(() => parseManifest(withEdges([{ from: 'a' }]))).toThrow(PageParseError)
    expect(() => parseManifest(withEdges(['a>b']))).toThrow(PageParseError)
    expect(() => parseManifest(withEdges({ from: 'a', to: 'b' }))).toThrow(PageParseError)
  })

  it('keeps one line where a file names the same one twice', () => {
    const twice = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'b' },
    ]
    expect(parseManifest(withEdges(twice)).readingEdges).toEqual([{ from: 'a', to: 'b' }])
  })

  // The order lines were drawn in says nothing, so two files meaning the same
  // thing are written the same way — the rule a tag set already follows.
  it('writes two spellings of the same lines identically', () => {
    const one = parseManifest(
      withEdges([
        { from: 'b', to: 'a' },
        { from: 'a', to: 'b' },
      ]),
    )
    const other = parseManifest(
      withEdges([
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ]),
    )
    expect(serializeManifest(one)).toBe(serializeManifest(other))
  })

  it('writes no lines key for a page with none', () => {
    expect(JSON.parse(serializeManifest(manifestWith(textEntry())))).not.toHaveProperty(
      'readingEdges',
    )
  })

  // Structure only, as with the reading order: whether both ends name objects
  // that are on the page is repair's question.
  it('opens a page whose line names an object that is not there', () => {
    expect(parseManifest(withEdges([{ from: 'a', to: 'ghost' }])).readingEdges).toEqual([
      { from: 'a', to: 'ghost' },
    ])
  })
})

describe("a page's readings", () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    hash: '9f2a1c0b7e4d5a63',
    source: 'manga-ocr',
    text: 'ふん！湯気で見間違えたんじゃないの？',
    original: 'ふん！湯気で見間違えたんじゃないの？',
    x: 4230,
    y: 2068,
    w: 377,
    h: 1032,
    confidence: 0.9987,
    label: 'text_bubble',
    ...over,
  })

  const ocrWith = (...candidates: Record<string, unknown>[]) =>
    JSON.stringify({
      schemaVersion: OCR_SCHEMA_VERSION,
      width: 4962,
      height: 7019,
      candidates,
    })

  it('round trips a reading whole', () => {
    const read = parseOcr(ocrWith(candidate()))
    expect(read.candidates).toHaveLength(1)
    expect(parseOcr(serializeOcr(read))).toEqual(read)
  })

  it('keeps a corrected reading apart from what was read', () => {
    const read = parseOcr(ocrWith(candidate({ text: 'ふん！湯気で見間違えたんじゃないの？！' })))
    expect(read.candidates[0].text).not.toBe(read.candidates[0].original)
  })

  /**
   * The identity is the one field nothing may be missing, since an entry
   * without one cannot be recognized on a rerun and would be added a second
   * time beside itself.
   */
  it('refuses a reading with no identity', () => {
    expect(() => parseOcr(ocrWith(candidate({ hash: '' })))).toThrow(PageParseError)
    expect(() => parseOcr(ocrWith(candidate({ hash: undefined })))).toThrow(PageParseError)
  })

  it('refuses a reading that will not say which model made it', () => {
    expect(() => parseOcr(ocrWith(candidate({ source: '' })))).toThrow(PageParseError)
  })

  /**
   * A source or a label this file has never heard of is a reading someone can
   * still use, and refusing it would lose work to a lookup miss.
   */
  it('opens a reading from a model it has never heard of', () => {
    const read = parseOcr(ocrWith(candidate({ source: 'something-later', label: 'line' })))
    expect(read.candidates[0].source).toBe('something-later')
    expect(read.candidates[0].label).toBe('line')
  })

  it('refuses a reading whose box has negative size', () => {
    expect(() => parseOcr(ocrWith(candidate({ w: -1 })))).toThrow(PageParseError)
  })

  /** An empty reading is legal: a recognizer that saw nothing said so. */
  it('opens a reading of nothing', () => {
    expect(parseOcr(ocrWith(candidate({ text: '', original: '' }))).candidates[0].text).toBe('')
  })

  it('refuses a file written by a newer version', () => {
    const newer = JSON.stringify({
      schemaVersion: OCR_SCHEMA_VERSION + 1,
      width: 1,
      height: 1,
      candidates: [],
    })
    expect(() => parseOcr(newer)).toThrow(PageParseError)
  })

  it('holds no readings for a page nothing has been run on', () => {
    const empty: OcrJson = parseOcr(ocrWith())
    expect(empty.candidates).toEqual([])
  })
})

describe("a text object's source", () => {
  const withSource = (source: unknown, ownSource?: string) =>
    JSON.stringify({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      readingOrder: ['a'],
      layers: [{ ...UPRIGHT, source, ...(ownSource === undefined ? {} : { ownSource }) }],
    })

  const only = (raw: string) => parseManifest(raw).layers[0] as TextLayerEntry

  /**
   * A page written before objects had a source opens with an empty one held by
   * nobody — not by a person. Starting it settled would put every object on
   * every old page out of reach of the first run that could have filled it.
   */
  it('opens a page written before objects had a source', () => {
    const older = JSON.parse(withSource(undefined))
    delete older.layers[0].source
    const object = only(JSON.stringify(older))
    expect(object.source).toEqual({ hash: null, by: 'auto' })
    expect(object.ownSource).toBe('')
  })

  it('carries a reading and who put it there through', () => {
    expect(only(withSource({ hash: '9f2a1c0b7e4d5a63', by: 'human' })).source).toEqual({
      hash: '9f2a1c0b7e4d5a63',
      by: 'human',
    })
  })

  /** A slot settled on nothing is a real state, and it is not the same state. */
  it('tells a slot nobody has touched from one somebody emptied', () => {
    expect(only(withSource({ hash: null, by: 'human' })).source.by).toBe('human')
  })

  it('carries a source someone wrote out themselves', () => {
    expect(only(withSource({ hash: 'own', by: 'human' }, '妖精っ')).ownSource).toBe('妖精っ')
  })

  it('refuses a hand nobody could have', () => {
    expect(() => only(withSource({ hash: null, by: 'model' }))).toThrow(PageParseError)
  })

  it('refuses a reading named by an empty string', () => {
    expect(() => only(withSource({ hash: '', by: 'auto' }))).toThrow(PageParseError)
  })

  it('leaves an untouched slot out of the file rather than writing it on each', () => {
    const page = parseManifest(withSource({ hash: null, by: 'auto' }))
    const written = JSON.parse(serializeManifest(page))
    expect(written.layers[0]).not.toHaveProperty('source')
    expect(written.layers[0]).not.toHaveProperty('ownSource')
  })

  it('round trips a settled slot', () => {
    const page = parseManifest(withSource({ hash: 'abc123', by: 'human' }, '妖精っ'))
    expect(parseManifest(serializeManifest(page))).toEqual(page)
  })

  /**
   * What an object was translated from moves no pixel, so it must not reach the
   * value a thumbnail is keyed on — the same reason tags do not.
   */
  it('keeps the source out of what a thumbnail is identified by', () => {
    const bare = serializeLayers(parseManifest(withSource({ hash: null, by: 'auto' })).layers)
    const sourced = serializeLayers(
      parseManifest(withSource({ hash: 'abc123', by: 'human' }, '妖精っ')).layers,
    )
    expect(bare).toBe(sourced)
  })
})
