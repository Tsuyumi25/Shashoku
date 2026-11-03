import { describe, expect, it } from 'vitest'
import {
  PageParseError,
  blankSourceBlock,
  blankTranslationBlock,
  parseManifest,
  parseOcr,
  serializeDrawnLayers,
  serializeManifest,
  serializeOcr,
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
import { emptyCounters, letterOf } from './numbers'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { shownLinesOf } from './units'
import { repairPage } from './repair'

/** The face every page in this file is written for. */
const FACE = 'face-1'

/** A second face, for the pages that have to tell two apart. */
const OTHER = 'face-2'

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
  face: FACE,
  body: body(),
}

/** `UPRIGHT` with its body written differently, for a test about that body. */
const withTranslation = (over: Record<string, unknown>) => ({ ...UPRIGHT, body: body(over) })

const withSource = (over: Record<string, unknown>) => ({
  kind: 'text',
  id: 's',
  visible: true,
  locked: false,
  side: 'source',
  body: body(over),
})

/** The unit `raw` and `manifestWith` hang their block off. */
function unitFor(id: string, members: string[] = [id]): TranslationUnit {
  return { id: `u-${id}`, members }
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
  units: TranslationUnit[] = [unitFor(String(entry.id ?? 'a'))],
  readingOrder: string[] = units.map((u) => u.id),
): string {
  return JSON.stringify({
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    ledgers: { [FACE]: { units, readingOrder } },
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
    ledgers: { [FACE]: { units: [unit], readingOrder: [unit.id], readingEdges: [] } },
    counters: emptyCounters(),
    layers: [entry],
  }
}

const firstText = (m: ManifestJson): TextLayerEntry => m.layers[0] as TextLayerEntry

const lettering = (m: ManifestJson): TranslationTextLayerEntry[] =>
  m.layers.filter(
    (l): l is TranslationTextLayerEntry => l.kind === 'text' && l.side === 'translation',
  )

/** `UPRIGHT` as the parser hands it back, for the tests that write one out. */
function textEntry(over: Partial<TranslationTextLayerEntry> = {}): TranslationTextLayerEntry {
  const entry = blankTranslationBlock('a', FACE, DEFAULT_TEXT_STYLE)
  entry.body.x = 512
  entry.body.y = 300
  entry.body.lines = ['hi']
  return Object.assign(entry, over)
}

/** The face a page from before faces is opened as. */
const LEGACY_FACE = 'face-9'

const legacyText = (
  id: string,
  side: 'source' | 'translation',
  over: Record<string, unknown> = {},
) => ({ kind: 'text', id, visible: true, locked: false, side, body: body(over) })

/** One sentence as the single-ledger format held it. */
const legacyUnit = (over: Record<string, unknown> = {}) => ({
  id: 'u-1',
  tags: [],
  source: { members: ['s1'], separators: [] },
  translation: { members: ['t1'], separators: [] },
  candidates: [],
  chosen: null,
  ...over,
})

function legacyPage(
  version: number,
  units: unknown[],
  layers: unknown[],
  over: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: version,
    revision: 2,
    name: 'p',
    width: 1200,
    height: 1700,
    translationUnits: units,
    readingOrder: ['u-1'],
    layers,
    ...over,
  })
}

describe('the translation candidates', () => {
  const two = [
    { id: 't1', lines: ['妳終於來了'] },
    { id: 't2', lines: ['你可算是來了'], human: true },
  ]

  const pooled = (chosen: string | null = null) => {
    const entry = textEntry()
    entry.body.candidates = two.map((c) => ({ ...c }))
    entry.body.chosen = chosen
    return entry
  }

  const withPool = (over: Record<string, unknown>) => raw(withTranslation(over))

  it('reads a block written before a translation had a pool as having none', () => {
    const parsed = firstText(parseManifest(raw(UPRIGHT), FACE)) as TranslationTextLayerEntry
    expect(parsed.body.candidates).toEqual([])
    expect(parsed.body.chosen).toBeNull()
  })

  it('round trips the pool and the slot', () => {
    const m = manifestWith(pooled('t2'))
    expect(parseManifest(serializeManifest(m), FACE)).toEqual(m)
  })

  it('writes neither key for a translation nobody has proposed anything for', () => {
    const out = JSON.parse(serializeManifest(manifestWith(textEntry())))
    expect(out.layers[0].body).not.toHaveProperty('candidates')
    expect(out.layers[0].body).not.toHaveProperty('chosen')
  })

  it('opens a slot naming a candidate that is not there as empty', () => {
    const parsed = parseManifest(withPool({ candidates: two, chosen: 'gone' }), FACE)
    const block = firstText(parsed) as TranslationTextLayerEntry
    expect(block.body.chosen).toBeNull()
    expect(block.body.lines).toEqual(['hi'])
  })

  it('refuses two candidates answering to one id', () => {
    const same = [two[0], { id: 't1', lines: ['別的'] }]
    expect(() => parseManifest(withPool({ candidates: same }), FACE)).toThrow(PageParseError)
  })

  it('refuses a line with a newline inside it, as on the block itself', () => {
    const bad = [{ id: 't1', lines: ['a\nb'] }]
    expect(() => parseManifest(withPool({ candidates: bad }), FACE)).toThrow(PageParseError)
  })

  it('refuses a candidate that does not say what it reads', () => {
    expect(() => parseManifest(withPool({ candidates: [{ id: 't1' }] }), FACE)).toThrow(
      PageParseError,
    )
  })

  it('round trips who proposed a candidate, and refuses an empty name', () => {
    const signed = textEntry()
    signed.body.candidates = [
      { id: 't1', lines: ['妳終於來了'], source: 'claude-code 2.1.219' },
    ]
    const m = manifestWith(signed)
    expect(parseManifest(serializeManifest(m), FACE)).toEqual(m)
    const blank = [{ id: 't1', lines: ['妳終於來了'], source: '' }]
    expect(() => parseManifest(withPool({ candidates: blank }), FACE)).toThrow(PageParseError)
  })

  /**
   * Two pages reading the same way are the same picture. What the pool is
   * holding behind the one in the slot moves nothing, and a thumbnail thrown
   * away over it is a page of compositing paid for nothing.
   */
  it('identifies the drawn page by what the slot resolves to', () => {
    const held = manifestWith(pooled('t1'))
    const typed = textEntry()
    typed.body.lines = [...two[0].lines]
    expect(serializeDrawnLayers(held, FACE)).toBe(serializeDrawnLayers(manifestWith(typed), FACE))
  })

  it('tells apart two pages reading differently out of one pool', () => {
    expect(serializeDrawnLayers(manifestWith(pooled('t1')), FACE)).not.toBe(
      serializeDrawnLayers(manifestWith(pooled('t2')), FACE),
    )
  })

  /** ⭐ The artwork's own words move no pixel, so they leave no fingerprint. */
  it('leaves the source out of what a page looks like', () => {
    const only = manifestWith(textEntry())
    const withArtwork: ManifestJson = {
      ...only,
      layers: [...only.layers, blankSourceBlock('s', DEFAULT_TEXT_STYLE)],
    }
    expect(serializeDrawnLayers(withArtwork, FACE)).toBe(serializeDrawnLayers(only, FACE))
  })

  /** ⭐ And neither does another face's lettering, which this face never draws. */
  it("leaves another face's lettering out of what this face looks like", () => {
    const mine = manifestWith(textEntry())
    const both: ManifestJson = {
      ...mine,
      layers: [...mine.layers, blankTranslationBlock('b', OTHER, DEFAULT_TEXT_STYLE)],
    }
    expect(serializeDrawnLayers(both, FACE)).toBe(serializeDrawnLayers(mine, FACE))
    expect(serializeDrawnLayers(both, OTHER)).not.toBe(serializeDrawnLayers(both, FACE))
  })
})

describe('which face a block of lettering belongs to', () => {
  it('carries the face through and writes it back', () => {
    const block = firstText(parseManifest(raw(UPRIGHT), OTHER)) as TranslationTextLayerEntry
    expect(block.face).toBe(FACE)
    expect(JSON.parse(serializeManifest(manifestWith(textEntry()))).layers[0].face).toBe(FACE)
  })

  /**
   * A block of lettering nobody can say the language of draws into whichever
   * face happens to ask, so the page is refused rather than opened wrong.
   */
  it('refuses lettering that names no face', () => {
    const { face: _f, ...faceless } = UPRIGHT
    expect(() => parseManifest(raw(faceless), FACE)).toThrow(PageParseError)
    expect(() => parseManifest(raw({ ...UPRIGHT, face: '' }), FACE)).toThrow(PageParseError)
  })

  /** The artwork's words belong to every face, so they name none. */
  it('writes no face on the artwork', () => {
    const m: ManifestJson = {
      ...manifestWith(textEntry()),
      layers: [blankSourceBlock('s', DEFAULT_TEXT_STYLE)],
    }
    expect(JSON.parse(serializeManifest(m)).layers[0]).not.toHaveProperty('face')
  })
})

describe("every face's reading of one page", () => {
  const sourceBlock = (id: string, tags: string[] = []) => {
    const block = blankSourceBlock(id, DEFAULT_TEXT_STYLE)
    block.body.tags = tags
    return block
  }

  const twoFaces = (): ManifestJson => {
    const s1 = sourceBlock('s1', ['心聲', '框内'])
    s1.body.by = 'human'
    s1.body.from = 'abc123'
    const s2 = sourceBlock('s2')
    const t1 = blankTranslationBlock('t1', FACE, DEFAULT_TEXT_STYLE)
    t1.body.candidates = [{ id: 'c1', lines: ['妳終於來了'], human: true }]
    t1.body.chosen = 'c1'
    const t2 = blankTranslationBlock('t2', FACE, DEFAULT_TEXT_STYLE)
    const t3 = blankTranslationBlock('t3', OTHER, DEFAULT_TEXT_STYLE)
    t3.body.candidates = [{ id: 'c2', lines: ['You finally came'], source: 'claude-code' }]
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 4,
      name: 'p',
      width: 1200,
      height: 1700,
      ledgers: {
        [FACE]: {
          units: [
            { id: 'u-a', members: ['s1', 't1'] },
            { id: 'u-b', members: ['s2', 't2'] },
          ],
          readingOrder: ['u-b', 'u-a'],
          readingEdges: [{ from: 'u-b', to: 'u-a' }],
        },
        [OTHER]: {
          units: [{ id: 'u-c', members: ['s1', 's2', 't3'] }],
          readingOrder: ['u-c'],
          readingEdges: [],
        },
      },
      counters: emptyCounters(),
      layers: [s1, s2, t1, t2, t3],
    }
  }

  /**
   * ⭐ Two faces cutting the same artwork into sentences their own way is the
   * whole point of a ledger per face: one source block stands in one sentence
   * here and in a two-block sentence there, and the file says so.
   */
  it('round trips a page both faces have read differently', () => {
    const m = twoFaces()
    expect(parseManifest(serializeManifest(m), FACE)).toEqual(m)
  })

  it('refuses a ledger kept under no name at all', () => {
    const page = JSON.parse(serializeManifest(twoFaces()))
    page.ledgers[''] = { units: [], readingOrder: [] }
    expect(() => parseManifest(JSON.stringify(page), FACE)).toThrow(PageParseError)
  })

  it('reads a page nobody has started reading as having no ledgers', () => {
    const page = JSON.parse(serializeManifest(twoFaces()))
    delete page.ledgers
    expect(parseManifest(JSON.stringify(page), FACE).ledgers).toEqual({})
  })

  // Which sentence a block is in would depend on which was searched first.
  it('refuses two sentences answering to one id', () => {
    const page = JSON.parse(serializeManifest(twoFaces()))
    page.ledgers[FACE].units.push({ id: 'u-a', members: [] })
    expect(() => parseManifest(JSON.stringify(page), FACE)).toThrow(PageParseError)
  })
})

describe('a page from before faces', () => {
  const opened = (units: unknown[], layers: unknown[], over?: Record<string, unknown>) =>
    parseManifest(legacyPage(15, units, layers, over), LEGACY_FACE)

  const threeBlocks = [
    legacyText('s1', 'source'),
    legacyText('t1', 'translation'),
    legacyText('t2', 'translation'),
  ]

  const twoWay = (over: Record<string, unknown>) =>
    legacyUnit({ translation: { members: ['t1', 't2'], separators: [] }, ...over })

  /**
   * ⚠️ The migration the per-block pool exists for. A candidate written against
   * two blocks was two pieces, and each piece is that block's words — dealing
   * them out is the only reading that keeps the sentence set the way it was.
   */
  it('deals a candidate with one piece per block onto the blocks', () => {
    const page = opened(
      [twoWay({ candidates: [{ id: 'c1', pieces: [['左'], ['右']], human: true }], chosen: 'c1' })],
      threeBlocks,
    )
    const [t1, t2] = lettering(page)
    expect(t1!.body.candidates).toEqual([{ id: 'c1', human: true, lines: ['左'] }])
    expect(t1!.body.chosen).toBe('c1')
    expect(t2!.body.candidates).toEqual([{ id: 'c1', human: true, lines: ['右'] }])
    expect(t2!.body.chosen).toBe('c1')
  })

  /**
   * ⚠️ One that no longer fits — what a deleted block leaves behind — has no
   * block its later pieces can go to. Joined onto the first, every word of it
   * is still choosable; dropped, it would be gone.
   */
  it('joins a candidate that no longer fits onto the first block', () => {
    const page = opened(
      [twoWay({ candidates: [{ id: 'c1', pieces: [['轟'], ['隆'], ['ゴゴゴ']] }], chosen: 'c1' })],
      threeBlocks,
    )
    const [t1, t2] = lettering(page)
    expect(t1!.body.candidates).toEqual([{ id: 'c1', lines: ['轟/隆/ゴゴゴ'] }])
    expect(t1!.body.chosen).toBe('c1')
    expect(t2!.body.candidates).toEqual([])
    expect(t2!.body.chosen).toBeNull()
  })

  /** The joiner stands between pieces; a break inside one is still a break. */
  it('keeps the breaks inside a piece it had to join', () => {
    const page = opened(
      [twoWay({ candidates: [{ id: 'c1', pieces: [['轟', '隆']] }] })],
      threeBlocks,
    )
    expect(lettering(page)[0]!.body.candidates[0]!.lines).toEqual(['轟', '隆'])
  })

  /** A candidate nobody picked arrives in the drawer with nothing in the slot. */
  it('leaves the slot empty where the sentence had picked nothing', () => {
    const page = opened(
      [twoWay({ candidates: [{ id: 'c1', pieces: [['左'], ['右']] }], chosen: null })],
      threeBlocks,
    )
    expect(lettering(page).map((b) => b.body.chosen)).toEqual([null, null])
  })

  /**
   * ⭐ What a balloon means is a fact about the balloon, so the sentence's tags
   * become every one of its source blocks' — which is what the sentence's tags
   * are read back out of.
   */
  it("gives every source block of a sentence the sentence's tags", () => {
    const page = opened(
      [
        legacyUnit({
          tags: ['心聲', '框内'],
          source: { members: ['s1', 's2'], separators: [] },
        }),
      ],
      [legacyText('s1', 'source'), legacyText('s2', 'source'), legacyText('t1', 'translation')],
    )
    const sources = page.layers.filter(
      (l): l is SourceTextLayerEntry => l.kind === 'text' && l.side === 'source',
    )
    expect(sources.map((s) => s.body.tags)).toEqual([
      ['心聲', '框内'],
      ['心聲', '框内'],
    ])
  })

  /** ⭐ One ledger, filed under the face the project opened the page as. */
  it('files the one ledger under the face it is opened as', () => {
    const page = opened([twoWay({})], threeBlocks, {
      readingEdges: [{ from: 'u-1', to: 'u-2' }],
    })
    expect(Object.keys(page.ledgers)).toEqual([LEGACY_FACE])
    expect(page.ledgers[LEGACY_FACE]).toEqual({
      units: [{ id: 'u-1', members: ['s1', 't1', 't2'] }],
      readingOrder: ['u-1'],
      readingEdges: [{ from: 'u-1', to: 'u-2' }],
    })
  })

  it('stamps every block of lettering with that face', () => {
    const page = opened([twoWay({})], threeBlocks)
    expect(lettering(page).map((b) => b.face)).toEqual([LEGACY_FACE, LEGACY_FACE])
  })

  /** And writes it back out as a page of the current shape. */
  it('comes back out as a page of faces', () => {
    const page = opened([twoWay({ candidates: [{ id: 'c1', pieces: [['左'], ['右']] }] })], threeBlocks)
    const written = JSON.parse(serializeManifest(page))
    expect(written.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(written).not.toHaveProperty('translationUnits')
    expect(written).not.toHaveProperty('readingOrder')
    expect(Object.keys(written.ledgers)).toEqual([LEGACY_FACE])
    expect(written.layers[1].face).toBe(LEGACY_FACE)
    expect(written.layers[1].body.candidates).toEqual([{ id: 'c1', lines: ['左'] }])
  })
})

describe('text object rotation', () => {
  it('reads a page written before objects could be turned as upright', () => {
    expect(firstText(parseManifest(raw(UPRIGHT), FACE)).body.rotation).toBe(0)
  })

  it('carries a turn through', () => {
    const parsed = parseManifest(raw(withTranslation({ rotation: -0.7853981633974483 })), FACE)
    expect(firstText(parsed).body.rotation).toBeCloseTo(-Math.PI / 4, 12)
  })

  it('refuses a turn that is not a number', () => {
    expect(() => parseManifest(raw(withTranslation({ rotation: '45deg' })), FACE)).toThrow(
      PageParseError,
    )
    expect(() => parseManifest(raw(withTranslation({ rotation: Number.NaN })), FACE)).toThrow(
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
    expect(firstText(parseManifest(out, FACE)).body.rotation).toBe(1.25)
  })
})

describe('a text object stands where it was put', () => {
  it('keeps a position between two pixels, which is what a rasterizer resolves', () => {
    const parsed = firstText(parseManifest(raw(withTranslation({ x: 512.37, y: 300.5 })), FACE))
    expect([parsed.body.x, parsed.body.y]).toEqual([512.37, 300.5])
  })

  it('refuses a position that is not a number', () => {
    expect(() => parseManifest(raw(withTranslation({ x: '512' })), FACE)).toThrow(PageParseError)
    expect(() =>
      parseManifest(raw(withTranslation({ y: Number.POSITIVE_INFINITY })), FACE),
    ).toThrow(PageParseError)
  })

  /**
   * Which point of its frame the position names is derived from the object's
   * alignment now, so a page that still carries the field opens without it.
   */
  it('opens a page that names a point of its own, ignoring the field', () => {
    const parsed = firstText(parseManifest(raw({ ...UPRIGHT, anchor: 'bottom-right' }), FACE))
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
    expect(() => parseManifest(JSON.stringify(sizeless), FACE)).toThrow(PageParseError)
  })

  it('carries the size through', () => {
    const parsed = parseManifest(raw(UPRIGHT), FACE)
    expect([parsed.width, parsed.height]).toEqual([1200, 1700])
  })

  it('round trips a size', () => {
    const source = { ...manifestWith(textEntry()), width: 800, height: 1200 }
    expect(parseManifest(serializeManifest(source), FACE)).toEqual(source)
  })

  it('always writes one', () => {
    const out = JSON.parse(serializeManifest(manifestWith(textEntry())))
    expect([out.width, out.height]).toEqual([1200, 1700])
  })

  it('refuses a size no page could have', () => {
    const bad = { ...JSON.parse(raw(UPRIGHT)), width: 0 }
    expect(() => parseManifest(JSON.stringify(bad), FACE)).toThrow(PageParseError)
  })
})

describe("the page's name", () => {
  it('carries it through and writes it back', () => {
    expect(parseManifest(raw(UPRIGHT), FACE).name).toBe('p')
    expect(JSON.parse(serializeManifest(manifestWith(textEntry()))).name).toBe('p')
  })

  /**
   * A page with no name has nothing to show in a list, and there is no source
   * filename left to fall back on — the page left that behind when it was made.
   */
  it('refuses a page with no name', () => {
    const { name: _n, ...nameless } = JSON.parse(raw(UPRIGHT))
    expect(() => parseManifest(JSON.stringify(nameless), FACE)).toThrow(PageParseError)
  })

  it('refuses an empty one', () => {
    const bad = { ...JSON.parse(raw(UPRIGHT)), name: '' }
    expect(() => parseManifest(JSON.stringify(bad), FACE)).toThrow(PageParseError)
  })
})

describe('opacity and blend mode', () => {
  const firstEntry = (m: ManifestJson) => m.layers[0]!

  it('reads an entry that names neither as opaque and normal', () => {
    const parsed = firstEntry(parseManifest(raw(UPRIGHT), FACE))
    expect(parsed.opacity).toBe(1)
    expect(parsed.blendMode).toBe('normal')
  })

  // Photoshop's default for a group, and the one that needs no buffer.
  it('reads a folder that names no blend mode as pass-through', () => {
    const folder = { kind: 'group', id: 'g', name: '對白', visible: true, locked: false, children: [] }
    expect(firstEntry(parseManifest(raw(folder, []), FACE)).blendMode).toBe('pass-through')
  })

  it('refuses an opacity outside the range', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, opacity: 1.5 }), FACE)).toThrow(PageParseError)
    expect(() => parseManifest(raw({ ...UPRIGHT, opacity: -0.1 }), FACE)).toThrow(PageParseError)
    expect(() => parseManifest(raw({ ...UPRIGHT, opacity: '50%' }), FACE)).toThrow(PageParseError)
  })

  it('refuses a blend mode nothing can draw', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, blendMode: 'divide' }), FACE)).toThrow(
      PageParseError,
    )
  })

  // Pass-through says "no buffer of my own", which only a container can mean.
  it('refuses pass-through on anything that is not a folder', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, blendMode: 'pass-through' }), FACE)).toThrow(
      PageParseError,
    )
    expect(() => parseManifest(raw({ ...PATCH, blendMode: 'pass-through' }, []), FACE)).toThrow(
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
    const parsed = firstEntry(parseManifest(serializeManifest(manifestWith(faded)), FACE))
    expect(parsed.opacity).toBe(0.4)
    expect(parsed.blendMode).toBe('multiply')
  })
})

describe('the effects a node carries', () => {
  const firstEntry = (m: ManifestJson) => m.layers[0]!
  const STROKE = { kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' } as const

  it('reads an entry that names none as carrying none', () => {
    expect(firstEntry(parseManifest(raw(UPRIGHT), FACE)).effects).toEqual([])
    expect(firstEntry(parseManifest(raw(PATCH, []), FACE)).effects).toEqual([])
  })

  it('leaves an empty list out of the file rather than writing one on every entry', () => {
    const out = serializeManifest(manifestWith(textEntry()))
    expect(JSON.parse(out).layers[0]).not.toHaveProperty('effects')
  })

  /** Not a text object's own property any more: a layer wears one the same way. */
  it('round trips a stroke on a raster layer as readily as on a text object', () => {
    for (const entry of [{ ...PATCH, effects: [STROKE] }, { ...UPRIGHT, effects: [STROKE] }]) {
      expect(firstEntry(parseManifest(raw(entry, []), FACE)).effects).toEqual([STROKE])
    }
  })

  /** Turned down to nothing, a stroke keeps its colour for when it is turned up again. */
  it('round trips a stroke of no width with its colour and position', () => {
    const resting = { ...STROKE, width: 0 }
    expect(firstEntry(parseManifest(raw({ ...UPRIGHT, effects: [resting] }), FACE)).effects).toEqual(
      [resting],
    )
  })

  it('refuses a stroke of negative width', () => {
    expect(() =>
      parseManifest(raw({ ...UPRIGHT, effects: [{ ...STROKE, width: -1 }] }), FACE),
    ).toThrow(PageParseError)
  })

  it('refuses an effect of a kind it has never heard of', () => {
    expect(() => parseManifest(raw({ ...UPRIGHT, effects: [{ kind: 'glow' }] }), FACE)).toThrow(
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
    expect(serializeDrawnLayers(stroked, FACE)).not.toBe(serializeDrawnLayers(plain, FACE))
  })
})

describe('a raster layer carries its own frame', () => {
  const firstRaster = (m: ManifestJson) => m.layers[0] as RasterLayerEntry

  it('carries the frame through', () => {
    const parsed = firstRaster(parseManifest(raw(PATCH, []), FACE))
    expect([parsed.x, parsed.y, parsed.w, parsed.h]).toEqual([10, 20, 30, 40])
  })

  // A blank layer created by the panel's button, before anything is written to it.
  it('accepts a layer that has no frame yet', () => {
    const blank = { ...PATCH, x: 0, y: 0, w: 0, h: 0 }
    expect(firstRaster(parseManifest(raw(blank, []), FACE)).w).toBe(0)
  })

  it('refuses a frame that does not land on whole pixels', () => {
    expect(() => parseManifest(raw({ ...PATCH, x: 10.5 }, []), FACE)).toThrow(PageParseError)
  })

  it('refuses a negative size', () => {
    expect(() => parseManifest(raw({ ...PATCH, w: -1 }, []), FACE)).toThrow(PageParseError)
  })

  it('refuses a frame it was never given', () => {
    const { w: _w, ...noWidth } = PATCH
    expect(() => parseManifest(raw(noWidth, []), FACE)).toThrow(PageParseError)
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
      ledgers: {
        [FACE]: {
          units: [{ id: 'u-a', members: ['a', 'b'] }],
          readingOrder: ['u-a'],
          readingEdges: [],
        },
      },
      counters: emptyCounters(),
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
          children: [textEntry(), textEntry({ id: 'b' })],
        },
      ],
    }
    expect(parseManifest(serializeManifest(source), FACE)).toEqual(source)
  })

  it('refuses a page from a version it does not know', () => {
    const older = JSON.stringify({ schemaVersion: 2, revision: 0, layers: [] })
    expect(() => parseManifest(older, FACE)).toThrow(PageParseError)
  })

  it('refuses a page written by a newer version', () => {
    const newer = JSON.stringify({
      ...JSON.parse(raw(UPRIGHT)),
      schemaVersion: MANIFEST_SCHEMA_VERSION + 1,
    })
    expect(() => parseManifest(newer, FACE)).toThrow(PageParseError)
  })

  // The style-era versions kept every effect inside the text style, where this
  // parser no longer looks. Reading such a page would silently drop the stroke
  // off every object on it, so it is refused instead — and the refusal has to be
  // the version's, since the style parser ignores keys it does not know and
  // would raise nothing.
  it('refuses the last version that hid the strokes in the style', () => {
    const before = legacyPage(
      12,
      [legacyUnit()],
      [
        legacyText('t1', 'translation', {
          style: {
            ...DEFAULT_TEXT_STYLE,
            effects: [{ kind: 'stroke', width: 3, color: '#ffffff', position: 'outside' }],
          },
        }),
      ],
    )
    expect(() => parseManifest(before, LEGACY_FACE)).toThrow(PageParseError)
  })

  /**
   * v13 stored what the person typed; v14 stores markup, where `<` opens a tag.
   * Reading an old page without escaping it would eat the angle brackets of
   * every `<ゴゴゴ>` ever typed, and the words would be gone for good the next
   * time the page was written out.
   */
  it('reads a page from the plain-text version as the markup it meant', () => {
    const old = legacyPage(
      13,
      [legacyUnit({ candidates: [{ id: 'c1', pieces: [['Q&A', '<小聲>']] }], chosen: 'c1' })],
      [
        legacyText('s1', 'source', { lines: ['<b>這是', 'A&B'] }),
        legacyText('t1', 'translation'),
      ],
    )
    const page = parseManifest(old, LEGACY_FACE)
    expect(page.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(firstText(page).body.lines).toEqual(['&lt;b>這是', 'A&amp;B'])
    const block = lettering(page)[0]!
    expect(block.body.candidates[0]!.lines).toEqual(['Q&amp;A', '&lt;小聲>'])
    expect(shownLinesOf(block)).toEqual(['Q&A', '<小聲>'])
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
   * back out as the current version, so the file says what it now holds.
   */
  it('reads a page written before characters could be scaled as unscaled', () => {
    const before = legacyPage(
      14,
      [legacyUnit()],
      [legacyText('t1', 'translation', { style: unscaled() })],
    )
    const page = parseManifest(before, LEGACY_FACE)
    expect(firstText(page).body.style).toEqual(DEFAULT_TEXT_STYLE)
    expect(page.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(JSON.parse(serializeManifest(page)).schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
  })

  /** The escaping and the scales are two migrations one old page needs both of. */
  it('gives a plain-text page the unscaled characters as well as the escaping', () => {
    const old = legacyPage(
      13,
      [legacyUnit()],
      [legacyText('t1', 'translation', { lines: ['<b>這是'], style: unscaled() })],
    )
    const page = parseManifest(old, LEGACY_FACE)
    expect(firstText(page).body.lines).toEqual(['&lt;b>這是'])
    expect(firstText(page).body.style).toEqual(DEFAULT_TEXT_STYLE)
  })

  it('leaves a page already stored as markup alone', () => {
    const page = parseManifest(raw(withTranslation({ lines: ['<b>這是', 'A&amp;B'] })), FACE)
    expect(firstText(page).body.lines).toEqual(['<b>這是', 'A&amp;B'])
  })

  /**
   * The registry is advisory, so a name it has never heard is data the user
   * typed rather than a dangling reference — refusing the page would lose it.
   */
  const tagged = (tags: unknown) => raw(withSource({ tags }))

  it('opens a page carrying a tag no registry names', () => {
    const block = parseManifest(tagged(['角色/ゆみ']), FACE).layers[0] as SourceTextLayerEntry
    expect(block.body.tags).toEqual(['角色/ゆみ'])
  })

  it('refuses a tag that is not a non-empty string', () => {
    expect(() => parseManifest(tagged([7]), FACE)).toThrow(PageParseError)
    expect(() => parseManifest(tagged(['  ']), FACE)).toThrow(PageParseError)
  })

  /**
   * `parseSourceBody` and `serializeLayerEntry` are two pieces of hand-written
   * code that happen to agree; the types cannot check that they do. Nothing
   * downstream would notice if they stopped — a set that came back reordered
   * or with a duplicate restored still typechecks, and only the group-by-value
   * view would show it, as drift that is not there.
   */
  it('writes a tag set in one canonical order and reads it back the same', () => {
    const messy = tagged(['心聲', '框内', '心聲', ' 框内 '])
    const written = JSON.parse(serializeManifest(parseManifest(messy, FACE)))
    expect(written.layers[0].body.tags).toEqual(['心聲', '框内'])

    expect(serializeManifest(parseManifest(tagged(['框内', '心聲']), FACE))).toBe(
      serializeManifest(parseManifest(messy, FACE)),
    )
  })

  it('writes no tags key for artwork nobody has classified', () => {
    const m: ManifestJson = {
      ...manifestWith(textEntry()),
      layers: [blankSourceBlock('s', DEFAULT_TEXT_STYLE)],
    }
    expect(JSON.parse(serializeManifest(m)).layers[0].body).not.toHaveProperty('tags')
  })

  it('round trips tagged artwork beside a block with a style of its own', () => {
    const marked = textEntry()
    marked.body.style = { ...DEFAULT_TEXT_STYLE, fontSizePx: 48 }
    const artwork = blankSourceBlock('s', DEFAULT_TEXT_STYLE)
    artwork.body.tags = ['心聲', '框内']
    const m: ManifestJson = {
      ...manifestWith(marked, unitFor('a', ['s', 'a'])),
      layers: [marked, artwork],
    }
    expect(parseManifest(serializeManifest(m), FACE)).toEqual(m)
  })

  it('refuses a line with a newline inside it, since lines are the breaks', () => {
    expect(() => parseManifest(raw(withTranslation({ lines: ['a\nb'] })), FACE)).toThrow(
      PageParseError,
    )
  })

  // Structure is this layer's whole job: a page whose order has drifted still
  // opens, and repair puts it right.
  it('opens a page whose reading order disagrees with its sentences', () => {
    const parsed = parseManifest(raw(UPRIGHT, [unitFor('a')], ['ghost']), FACE)
    expect(parsed.ledgers[FACE]!.readingOrder).toEqual(['ghost'])
  })
})

describe('the lines drawn between sentences', () => {
  function withEdges(edges: unknown): string {
    return JSON.stringify({
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      ledgers: {
        [FACE]: {
          units: [unitFor('a'), unitFor('b')],
          readingOrder: ['u-a', 'u-b'],
          readingEdges: edges,
        },
      },
      layers: [UPRIGHT, { ...UPRIGHT, id: 'b' }],
    })
  }

  const edgesOf = (rawPage: string) => parseManifest(rawPage, FACE).ledgers[FACE]!.readingEdges

  // A page nobody has drawn on is the model's ordinary starting state, not a
  // page missing something.
  it('reads a page with no lines on it as a page with no lines on it', () => {
    expect(edgesOf(raw(UPRIGHT))).toEqual([])
  })

  it('carries a line through', () => {
    expect(edgesOf(withEdges([{ from: 'u-a', to: 'u-b' }]))).toEqual([{ from: 'u-a', to: 'u-b' }])
  })

  it('refuses a sentence pointed at itself, which says nothing', () => {
    expect(() => edgesOf(withEdges([{ from: 'u-a', to: 'u-a' }]))).toThrow(PageParseError)
  })

  it('refuses an end that names nothing', () => {
    expect(() => edgesOf(withEdges([{ from: 'u-a', to: '' }]))).toThrow(PageParseError)
    expect(() => edgesOf(withEdges([{ from: 'u-a' }]))).toThrow(PageParseError)
    expect(() => edgesOf(withEdges(['a>b']))).toThrow(PageParseError)
    expect(() => edgesOf(withEdges({ from: 'u-a', to: 'u-b' }))).toThrow(PageParseError)
  })

  it('keeps one line where a file names the same one twice', () => {
    const twice = [
      { from: 'u-a', to: 'u-b' },
      { from: 'u-a', to: 'u-b' },
    ]
    expect(edgesOf(withEdges(twice))).toEqual([{ from: 'u-a', to: 'u-b' }])
  })

  // The order lines were drawn in says nothing, so two files meaning the same
  // thing are written the same way — the rule a tag set already follows.
  it('writes two spellings of the same lines identically', () => {
    const one = parseManifest(
      withEdges([
        { from: 'u-b', to: 'u-a' },
        { from: 'u-a', to: 'u-b' },
      ]),
      FACE,
    )
    const other = parseManifest(
      withEdges([
        { from: 'u-a', to: 'u-b' },
        { from: 'u-b', to: 'u-a' },
      ]),
      FACE,
    )
    expect(serializeManifest(one)).toBe(serializeManifest(other))
  })

  it('writes no lines key for a ledger with none', () => {
    const written = JSON.parse(serializeManifest(manifestWith(textEntry())))
    expect(written.ledgers[FACE]).not.toHaveProperty('readingEdges')
  })

  // Structure only, as with the reading order: whether both ends name sentences
  // that are on the page is repair's question.
  it('opens a page whose line names a sentence that is not there', () => {
    expect(edgesOf(withEdges([{ from: 'u-a', to: 'ghost' }]))).toEqual([
      { from: 'u-a', to: 'ghost' },
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
    expect(read.candidates[0]!.text).not.toBe(read.candidates[0]!.original)
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
    expect(read.candidates[0]!.source).toBe('something-later')
    expect(read.candidates[0]!.label).toBe('line')
  })

  it('refuses a reading whose box has negative size', () => {
    expect(() => parseOcr(ocrWith(candidate({ w: -1 })))).toThrow(PageParseError)
  })

  /** An empty reading is legal: a recognizer that saw nothing said so. */
  it('opens a reading of nothing', () => {
    expect(parseOcr(ocrWith(candidate({ text: '', original: '' }))).candidates[0]!.text).toBe('')
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
    expect(read.candidates[0]!.setAside).toBe(true)
    expect(parseOcr(serializeOcr(read))).toEqual(read)
  })

  it('carries nothing on a reading nobody has turned down', () => {
    const read = parseOcr(ocrWith(candidate()))
    expect(read.candidates[0]!.setAside).toBeUndefined()
    expect(JSON.parse(serializeOcr(read)).candidates[0]).not.toHaveProperty('setAside')
  })
})

describe("a text object's source", () => {
  const pageWith = (source: Record<string, unknown>) => raw(withSource(source))

  const only = (rawPage: string) => parseManifest(rawPage, FACE).layers[0] as SourceTextLayerEntry

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
    const letters = textEntry()
    letters.body.rotation = 0.4
    letters.body.style = { ...DEFAULT_TEXT_STYLE, fontSizePx: 40 }
    const artwork = blankSourceBlock('s', DEFAULT_TEXT_STYLE)
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
    const m: ManifestJson = {
      ...manifestWith(letters, unitFor('a', ['s', 'a'])),
      layers: [letters, artwork],
    }
    expect(parseManifest(serializeManifest(m), FACE)).toEqual(m)
  })

  it('leaves an untouched hand and an absent certificate out of the file', () => {
    const artwork = blankSourceBlock('s', DEFAULT_TEXT_STYLE)
    const m: ManifestJson = {
      ...manifestWith(textEntry(), unitFor('a', ['s', 'a'])),
      layers: [textEntry(), artwork],
    }
    const written = JSON.parse(serializeManifest(m))
    expect(written.layers[1].body).not.toHaveProperty('by')
    expect(written.layers[1].body).not.toHaveProperty('from')
  })
})

describe('the short numbers everything on a page wears', () => {
  /** A page numbered the way an edit leaves it, with every counter past its holders. */
  function numbered(): ManifestJson {
    const s1 = blankSourceBlock('s1', DEFAULT_TEXT_STYLE)
    s1.no = 1
    const t1 = blankTranslationBlock('t1', FACE, DEFAULT_TEXT_STYLE)
    t1.no = 1
    t1.numberedIn = 'u-a'
    t1.body.candidates = [
      { id: 'c1', no: 1, lines: ['一'], human: true },
      { id: 'c2', no: 3, lines: ['三'], source: 'claude-code' },
    ]
    return {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 3,
      name: 'p',
      width: 1200,
      height: 1700,
      ledgers: {
        [FACE]: {
          units: [{ id: 'u-a', no: 4, members: ['s1', 't1'] }],
          readingOrder: ['u-a'],
          readingEdges: [],
        },
      },
      counters: { source: 2, units: { [FACE]: 5 }, blocks: { 'u-a': 2 }, candidates: { t1: 4 } },
      layers: [s1, t1],
    }
  }

  it('round trips every number and every counter', () => {
    const m = numbered()
    expect(parseManifest(serializeManifest(m), FACE)).toEqual(m)
  })

  /**
   * A thumbnail is identified by what it draws. Numbers move no pixel, so a
   * renumbering must not throw away every thumbnail in the chapter.
   */
  it('leaves the drawn layers unchanged when the numbers change', () => {
    const m = numbered()
    const drawn = serializeDrawnLayers(m, FACE)
    const moved = numbered()
    const block = moved.layers[1] as TranslationTextLayerEntry
    block.no = 9
    block.numberedIn = 'u-z'
    moved.counters.source = 40

    expect(serializeDrawnLayers(moved, FACE)).toBe(drawn)
  })

  it('drops a number that is not one and lets repair hand out another', () => {
    const page = JSON.parse(serializeManifest(numbered()))
    page.layers[0].no = 0
    page.ledgers[FACE].units[0].no = 'four'
    page.layers[1].body.candidates[1].no = -2

    const parsed = parseManifest(JSON.stringify(page), FACE)
    expect((parsed.layers[0] as SourceTextLayerEntry).no).toBeUndefined()
    expect(parsed.ledgers[FACE].units[0].no).toBeUndefined()

    const { manifest } = repairPage(parsed, [FACE])
    const block = manifest.layers[1] as TranslationTextLayerEntry
    expect((manifest.layers[0] as SourceTextLayerEntry).no).toBe(2)
    expect(manifest.ledgers[FACE].units[0].no).toBe(5)
    expect(block.body.candidates.map((c) => c.no)).toEqual([1, 4])
  })

  /** A block whose sentence is written down nowhere has no number to keep. */
  it('forgets a number no sentence claims to have issued', () => {
    const page = JSON.parse(serializeManifest(numbered()))
    delete page.layers[1].numberedIn

    const parsed = parseManifest(JSON.stringify(page), FACE)
    expect((parsed.layers[1] as TranslationTextLayerEntry).no).toBeUndefined()
  })

  /** v16 is the last version written before anything on a page had a number. */
  it('reads a page from before the numbers and lets repair number it', () => {
    const page = JSON.parse(serializeManifest(numbered()))
    page.schemaVersion = 16
    delete page.counters
    delete page.layers[0].no
    delete page.layers[1].no
    delete page.layers[1].numberedIn
    delete page.ledgers[FACE].units[0].no
    for (const c of page.layers[1].body.candidates) delete c.no

    const parsed = parseManifest(JSON.stringify(page), FACE)
    expect(parsed.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION)
    expect(parsed.counters).toEqual(emptyCounters())

    const { manifest } = repairPage(parsed, [FACE])
    const block = manifest.layers[1] as TranslationTextLayerEntry
    expect((manifest.layers[0] as SourceTextLayerEntry).no).toBe(1)
    expect(manifest.ledgers[FACE].units[0].no).toBe(1)
    expect(block.no).toBe(1)
    expect(block.numberedIn).toBe('u-a')
    expect(block.body.candidates.map((c) => letterOf(c.no!))).toEqual(['a', 'b'])
    expect(manifest.counters).toEqual({
      source: 2,
      units: { [FACE]: 2 },
      blocks: { 'u-a': 2 },
      candidates: { t1: 3 },
    })
  })
})
