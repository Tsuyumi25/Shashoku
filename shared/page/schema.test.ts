import { describe, expect, it } from 'vitest'
import {
  PageParseError,
  parseManifest,
  parseOcr,
  serializeDrawnLayers,
  serializeManifest,
  serializeOcr,
  blankBlock,
} from './schema'
import type {
  ManifestJson,
  OcrJson,
  RasterLayerEntry,
  SourceTextLayerEntry,
  TextLayerEntry,
  TranslationTextLayerEntry,
  TranslationUnit,
} from './types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { shownLinesOf } from './units'

/** One body, as it is written to disk. */
const body = (over: Record<string, unknown> = {}) => ({
  x: 512,
  y: 300,
  lines: ['hi'],
  style: DEFAULT_TEXT_STYLE,
  ...over,
})

const UPRIGHT = {
  kind: 'text',
  id: 'a',
  visible: true,
  locked: false,
  side: 'translation',
  body: body(),
}

/** `UPRIGHT` with its body written differently, for a test about that body. */
const withTranslation = (over: Record<string, unknown>) => ({ ...UPRIGHT, body: body(over) })

const withSource = (over: Record<string, unknown>) => ({
  ...UPRIGHT,
  side: 'source',
  body: body(over),
})

/** The one translation `raw` and `manifestWith` hang their block off. */
function unitFor(id: string, over: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id: `u-${id}`,
    tags: [],
    source: { members: [id], separators: [] },
    translation: { members: [id], separators: [] },
    candidates: [],
    chosen: null,
    ...over,
  }
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

function raw(
  entry: Record<string, unknown>,
  readingOrder: string[] = ['u-a'],
  units: unknown[] = [unitFor(String(entry.id ?? 'a'))],
): string {
  return JSON.stringify({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    translationUnits: units,
    readingOrder,
    layers: [entry],
  })
}

function manifestWith(entry: TextLayerEntry, unit = unitFor(entry.id)): ManifestJson {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    translationUnits: [unit],
    readingOrder: [unit.id],
    readingEdges: [],
    layers: [entry],
  }
}

const firstText = (m: ManifestJson): TextLayerEntry => m.layers[0] as TextLayerEntry

/** `UPRIGHT` as the parser hands it back, for the tests that write one out. */
function textEntry(over: Partial<TextLayerEntry> = {}): TranslationTextLayerEntry {
  const entry = blankBlock('a', 'translation', DEFAULT_TEXT_STYLE)
  entry.body.x = 512
  entry.body.y = 300
  entry.body.lines = ['hi']
  return Object.assign(entry, over)
}

describe('the translation candidates', () => {
  const two = [
    { id: 't1', pieces: [['妳終於來了']] },
    { id: 't2', pieces: [['你可算是來了']], human: true },
  ]

  const withPool = (over: Partial<TranslationUnit>) =>
    raw(UPRIGHT, ['u-a'], [unitFor('a', over)])

  it('reads a page written before a translation had a pool as having none', () => {
    const parsed = parseManifest(raw(UPRIGHT)).translationUnits[0]
    expect(parsed.candidates).toEqual([])
    expect(parsed.chosen).toBeNull()
  })

  it('round trips the pool and the slot', () => {
    const m = manifestWith(textEntry(), unitFor('a', { candidates: two, chosen: 't2' }))
    expect(parseManifest(serializeManifest(m))).toEqual(m)
  })

  it('writes neither key for a translation nobody has proposed anything for', () => {
    const out = JSON.parse(serializeManifest(manifestWith(textEntry())))
    expect(out.translationUnits[0]).not.toHaveProperty('candidates')
    expect(out.translationUnits[0]).not.toHaveProperty('chosen')
  })

  it('opens a slot naming a candidate that is not there as empty', () => {
    const parsed = parseManifest(withPool({ candidates: two, chosen: 'gone' }))
    expect(parsed.translationUnits[0].chosen).toBeNull()
    expect(firstText(parsed).body.lines).toEqual(['hi'])
  })

  /**
   * ⚠️ The same fallback, for the other way a pointer comes loose: a reading
   * with too few pieces has no block to show some of its words from.
   */
  it('opens a slot naming a candidate with the wrong number of blocks as empty', () => {
    const short = [{ id: 't1', pieces: [['轟'], ['隆']] }]
    const parsed = parseManifest(withPool({ candidates: short, chosen: 't1' }))
    expect(parsed.translationUnits[0].chosen).toBeNull()
  })

  it('refuses two candidates answering to one id', () => {
    const same = [two[0], { id: 't1', pieces: [['別的']] }]
    expect(() => parseManifest(withPool({ candidates: same }))).toThrow(PageParseError)
  })

  it('refuses a line with a newline inside it, as on the block itself', () => {
    const bad = [{ id: 't1', pieces: [['a\nb']] }]
    expect(() => parseManifest(withPool({ candidates: bad }))).toThrow(PageParseError)
  })

  it('refuses a candidate proposing no blocks at all', () => {
    expect(() => parseManifest(withPool({ candidates: [{ id: 't1', pieces: [] }] }))).toThrow(
      PageParseError,
    )
  })

  it('round trips who proposed a candidate, and refuses an empty name', () => {
    const signed = [{ id: 't1', pieces: [['妳終於來了']], source: 'claude-code 2.1.219' }]
    const m = manifestWith(textEntry(), unitFor('a', { candidates: signed }))
    expect(parseManifest(serializeManifest(m))).toEqual(m)
    const blank = [{ id: 't1', pieces: [['妳終於來了']], source: '' }]
    expect(() => parseManifest(withPool({ candidates: blank }))).toThrow(PageParseError)
  })

  /**
   * Two pages reading the same way are the same picture. What the pool is
   * holding behind the one in the slot moves nothing, and a thumbnail thrown
   * away over it is a page of compositing paid for nothing.
   */
  it('identifies the drawn page by what the slot resolves to', () => {
    const held = manifestWith(textEntry(), unitFor('a', { candidates: two, chosen: 't1' }))
    const typed = manifestWith(textEntry({ body: { ...textEntry().body, lines: two[0].pieces[0] } }))
    expect(serializeDrawnLayers(held)).toBe(serializeDrawnLayers(typed))
  })

  it('tells apart two pages reading differently out of one pool', () => {
    const first = manifestWith(textEntry(), unitFor('a', { candidates: two, chosen: 't1' }))
    const second = manifestWith(textEntry(), unitFor('a', { candidates: two, chosen: 't2' }))
    expect(serializeDrawnLayers(first)).not.toBe(serializeDrawnLayers(second))
  })

  /** ⭐ The artwork's own words move no pixel, so they leave no fingerprint. */
  it('leaves the source out of what a page looks like', () => {
    const lettering = manifestWith(textEntry())
    const withArtwork: ManifestJson = {
      ...lettering,
      layers: [...lettering.layers, { ...blankBlock('s', 'source', DEFAULT_TEXT_STYLE) }],
    }
    expect(serializeDrawnLayers(withArtwork)).toBe(serializeDrawnLayers(lettering))
  })
})

describe('text object rotation', () => {
  it('reads a page written before objects could be turned as upright', () => {
    expect(firstText(parseManifest(raw(UPRIGHT))).body.rotation).toBe(0)
  })

  it('carries a turn through', () => {
    const parsed = parseManifest(raw(withTranslation({ rotation: -0.7853981633974483 })))
    expect(firstText(parsed).body.rotation).toBeCloseTo(-Math.PI / 4, 12)
  })

  it('refuses a turn that is not a number', () => {
    expect(() => parseManifest(raw(withTranslation({ rotation: '45deg' })))).toThrow(PageParseError)
    expect(() => parseManifest(raw(withTranslation({ rotation: Number.NaN })))).toThrow(
      PageParseError,
    )
  })

  it('leaves upright objects out of the file rather than writing a zero on each', () => {
    const out = serializeManifest(manifestWith(textEntry()))
    expect(JSON.parse(out).layers[0].body).not.toHaveProperty('rotation')
  })

  it('round trips a turned object', () => {
    const turned = textEntry()
    turned.body.rotation = 1.25
    const out = serializeManifest(manifestWith(turned))
    expect(firstText(parseManifest(out)).body.rotation).toBe(1.25)
  })
})

describe('a text object stands where it was put', () => {
  it('keeps a position between two pixels, which is what a rasterizer resolves', () => {
    const parsed = firstText(parseManifest(raw(withTranslation({ x: 512.37, y: 300.5 }))))
    expect([parsed.body.x, parsed.body.y]).toEqual([512.37, 300.5])
  })

  it('refuses a position that is not a number', () => {
    expect(() => parseManifest(raw(withTranslation({ x: '512' })))).toThrow(PageParseError)
    expect(() => parseManifest(raw(withTranslation({ y: Number.POSITIVE_INFINITY })))).toThrow(
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

describe('the effects a node carries', () => {
  const firstEntry = (m: ManifestJson) => m.layers[0]
  const STROKE = { kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' } as const

  it('reads an entry that names none as carrying none', () => {
    expect(firstEntry(parseManifest(raw(UPRIGHT))).effects).toEqual([])
    expect(firstEntry(parseManifest(raw(PATCH, []))).effects).toEqual([])
  })

  it('leaves an empty list out of the file rather than writing one on every entry', () => {
    const out = serializeManifest(manifestWith(textEntry()))
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('effects')
  })

  /** Not a text object's own property any more: a layer wears one the same way. */
  it('round trips a stroke on a raster layer as readily as on a text object', () => {
    for (const entry of [{ ...PATCH, effects: [STROKE] }, { ...UPRIGHT, effects: [STROKE] }]) {
      const order = entry.kind === 'text' ? ['a'] : []
      expect(firstEntry(parseManifest(raw(entry, order))).effects).toEqual([STROKE])
    }
  })

  /** Turned down to nothing, a stroke keeps its colour for when it is turned up again. */
  it('round trips a stroke of no width with its colour and position', () => {
    const resting = { ...STROKE, width: 0 }
    expect(firstEntry(parseManifest(raw({ ...UPRIGHT, effects: [resting] }))).effects).toEqual([resting])
  })

  it('refuses a stroke of negative width', () => {
    expect(() =>
      parseManifest(raw({ ...UPRIGHT, effects: [{ ...STROKE, width: -1 }] })),
    ).toThrow(PageParseError)
  })

  it('refuses an effect of a kind it has never heard of', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, effects: [{ kind: 'glow' }] }))).toThrow(
      PageParseError,
    )
  })

  /**
   * A stroke moves pixels, so a page that grew one is a different picture and
   * every thumbnail of it has to be redrawn.
   */
  it('counts towards what a page looks like', () => {
    const plain = manifestWith(textEntry())
    const stroked = manifestWith(textEntry({ effects: [STROKE] }))
    expect(serializeDrawnLayers(stroked)).not.toBe(serializeDrawnLayers(plain))
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
      translationUnits: [], readingOrder: ['b', 'a'],
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
          effects: [],
          children: [
            textEntry(),
            textEntry({ id: 'b' }),
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

  // The style-era versions kept every effect inside the text style, where this
  // parser no longer looks. Reading such a page would silently drop the stroke
  // off every object on it, so it is refused instead — and the refusal has to be
  // the version's, since the style parser ignores keys it does not know and
  // would raise nothing.
  it('refuses the last version that hid the strokes in the style', () => {
    const before = JSON.stringify({
      schemaVersion: 12,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      readingOrder: ['a'],
      layers: [
        {
          ...UPRIGHT,
          style: {
            ...DEFAULT_TEXT_STYLE,
            effects: [{ kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' }],
          },
        },
      ],
    })
    expect(() => parseManifest(before)).toThrow(PageParseError)
  })

  /**
   * v13 stored what the person typed; v14 stores markup, where `<` opens a tag.
   * Reading an old page without escaping it would eat the angle brackets of
   * every `<ゴゴゴ>` ever typed, and the words would be gone for good the next
   * time the page was written out.
   */
  it('reads a page from the plain-text version as the markup it meant', () => {
    const old = JSON.stringify({
      schemaVersion: 13,
      revision: 2,
      name: 'p',
      width: 1200,
      height: 1700,
      translationUnits: [
        {
          ...unitFor('a'),
          candidates: [{ id: 'c1', pieces: [['Q&A', '<小聲>']] }],
          chosen: 'c1',
        },
      ],
      readingOrder: ['u-a'],
      layers: [{ ...UPRIGHT, body: body({ lines: ['<b>這是', 'A&B'] }) }],
    })
    const page = parseManifest(old)
    expect(page.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(firstText(page).body.lines).toEqual(['&lt;b>這是', 'A&amp;B'])
    expect(page.translationUnits[0].candidates[0].pieces).toEqual([['Q&amp;A', '&lt;小聲>']])
    expect(shownLinesOf(page, firstText(page))).toEqual(['Q&A', '<小聲>'])
  })

  /** A style as it was written before the two character scales existed. */
  const unscaled = () => {
    const style: Record<string, unknown> = { ...DEFAULT_TEXT_STYLE }
    delete style.scaleXPercent
    delete style.scaleYPercent
    return style
  }

  /**
   * v15 added the two character scales. A page written before them was set at
   * the proportions the face was cut at, which is what 100 says — and it comes
   * back out as v15, so the file says what it now holds.
   */
  it('reads a page written before characters could be scaled as unscaled', () => {
    const before = JSON.stringify({
      schemaVersion: 14,
      revision: 2,
      name: 'p',
      width: 1200,
      height: 1700,
      translationUnits: [unitFor('a')],
      readingOrder: ['u-a'],
      layers: [{ ...UPRIGHT, body: body({ style: unscaled() }) }],
    })
    const page = parseManifest(before)
    expect(firstText(page).body.style).toEqual(DEFAULT_TEXT_STYLE)
    expect(page.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(JSON.parse(serializeManifest(page)).schemaVersion).toBe(15)
  })

  /** The escaping and the scales are two migrations one old page needs both of. */
  it('gives a plain-text page the unscaled characters as well as the escaping', () => {
    const old = JSON.stringify({
      schemaVersion: 13,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      translationUnits: [unitFor('a')],
      readingOrder: ['u-a'],
      layers: [{ ...UPRIGHT, body: body({ lines: ['<b>這是'], style: unscaled() }) }],
    })
    const page = parseManifest(old)
    expect(firstText(page).body.lines).toEqual(['&lt;b>這是'])
    expect(firstText(page).body.style).toEqual(DEFAULT_TEXT_STYLE)
  })

  it('leaves a page already stored as markup alone', () => {
    const page = parseManifest(raw(withTranslation({ lines: ['<b>這是', 'A&amp;B'] })))
    expect(firstText(page).body.lines).toEqual(['<b>這是', 'A&amp;B'])
  })

  /**
   * The registry is advisory, so a name it has never heard is data the user
   * typed rather than a dangling reference — refusing the page would lose it.
   */
  const tagged = (tags: unknown) => raw(UPRIGHT, ['u-a'], [{ ...unitFor('a'), tags }])

  it('opens a page carrying a tag no registry names', () => {
    expect(parseManifest(tagged(['角色/ゆみ'])).translationUnits[0].tags).toEqual(['角色/ゆみ'])
  })

  it('refuses a tag that is not a non-empty string', () => {
    expect(() => parseManifest(tagged([7]))).toThrow(PageParseError)
    expect(() => parseManifest(tagged(['  ']))).toThrow(PageParseError)
  })

  /**
   * `parseTextEntry` and `serializeLayerEntry` are two pieces of hand-written
   * code that happen to agree; the types cannot check that they do. Nothing
   * downstream would notice if they stopped — a set that came back reordered
   * or with a duplicate restored still typechecks, and only the group-by-value
   * view would show it, as drift that is not there.
   */
  it('writes a tag set in one canonical order and reads it back the same', () => {
    const messy = tagged(['心聲', '框内', '心聲', ' 框内 '])
    const written = JSON.parse(serializeManifest(parseManifest(messy)))
    expect(written.translationUnits[0].tags).toEqual(['心聲', '框内'])

    expect(serializeManifest(parseManifest(tagged(['框内', '心聲'])))).toBe(
      serializeManifest(parseManifest(messy)),
    )
  })

  it('round trips a translation carrying tags beside a block with a style of its own', () => {
    const marked = textEntry()
    marked.body.style = { ...DEFAULT_TEXT_STYLE, fontSizePx: 48 }
    const m = manifestWith(marked, unitFor('a', { tags: ['心聲', '框内'] }))
    expect(parseManifest(serializeManifest(m))).toEqual(m)
  })

  it('refuses a line with a newline inside it, since lines are the breaks', () => {
    expect(() => parseManifest(raw(withTranslation({ lines: ['a\nb'] })))).toThrow(PageParseError)
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
      translationUnits: [], readingOrder: ['a', 'b'],
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

  /**
   * ⭐ The whole point of saving it: an afternoon spent clearing a page has to
   * survive closing the project.
   */
  it('round trips a reading somebody set aside', () => {
    const read = parseOcr(ocrWith(candidate({ setAside: true })))
    expect(read.candidates[0].setAside).toBe(true)
    expect(parseOcr(serializeOcr(read))).toEqual(read)
  })

  it('carries nothing on a reading nobody has turned down', () => {
    const read = parseOcr(ocrWith(candidate()))
    expect(read.candidates[0].setAside).toBeUndefined()
    expect(JSON.parse(serializeOcr(read)).candidates[0]).not.toHaveProperty('setAside')
  })
})

describe("a text object's source", () => {
  const pageWith = (source: Record<string, unknown>) =>
    JSON.stringify({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      translationUnits: [unitFor('a')],
      readingOrder: ['u-a'],
      layers: [withSource(source)],
    })

  const only = (rawPage: string) =>
    parseManifest(rawPage).layers[0] as SourceTextLayerEntry

  /**
   * A source written by nobody is what a fresh object has. Starting it settled
   * would put every object on every page out of reach of the first run that
   * could have filled it.
   */
  it('opens a source with no hand on it as held by nobody', () => {
    expect(only(pageWith({})).body.by).toBe('auto')
    expect(only(pageWith({})).body.from).toBeUndefined()
  })

  it('carries the words, the hand and the birth certificate through', () => {
    const object = only(pageWith({ lines: ['妖精っ'], by: 'human', from: '9f2a1c0b7e4d5a63' }))
    expect(object.body.lines).toEqual(['妖精っ'])
    expect(object.body.by).toBe('human')
    expect(object.body.from).toBe('9f2a1c0b7e4d5a63')
  })

  /** A source settled on nothing is a real state, and it is not the same state. */
  it('tells a source nobody has touched from one somebody emptied', () => {
    expect(only(pageWith({ lines: [''], by: 'human' })).body.by).toBe('human')
  })

  it('refuses a hand nobody could have', () => {
    expect(() => only(pageWith({ by: 'model' }))).toThrow(PageParseError)
  })

  /**
   * ⭐ A block of each kind comes back whole, each with its own words, position,
   * angle and style — which is the whole of what makes them the same kind of
   * thing.
   */
  it('round trips both sides, each block set its own way', () => {
    const lettering = textEntry()
    lettering.body.rotation = 0.4
    lettering.body.style = { ...DEFAULT_TEXT_STYLE, fontSizePx: 40 }
    const artwork = blankBlock('s', 'source', DEFAULT_TEXT_STYLE)
    artwork.body = {
      ...artwork.body,
      lines: ['ふん', 'そうかい'],
      x: 20,
      y: 30,
      rotation: -1.1,
      style: { ...DEFAULT_TEXT_STYLE, direction: 'vertical', fontSizePx: 18 },
      by: 'human',
      from: 'abc123',
    }
    const unit = unitFor('a', { source: { members: ['s'], separators: [] } })
    const m: ManifestJson = {
      ...manifestWith(lettering, unit),
      layers: [lettering, artwork],
    }
    expect(parseManifest(serializeManifest(m))).toEqual(m)
  })

  it('leaves an untouched hand and an absent certificate out of the file', () => {
    const artwork = blankBlock('s', 'source', DEFAULT_TEXT_STYLE)
    const m: ManifestJson = {
      ...manifestWith(textEntry(), unitFor('a', { source: { members: ['s'], separators: [] } })),
      layers: [textEntry(), artwork],
    }
    const written = JSON.parse(serializeManifest(m))
    expect(written.layers[1].body).not.toHaveProperty('by')
    expect(written.layers[1].body).not.toHaveProperty('from')
  })
})
