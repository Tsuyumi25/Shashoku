import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, TextLayerEntry, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { validatePage } from './validate'
import type { ReadingEdge } from './readingGraph'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { emptyCounters } from './numbers'
import { blankSourceBlock, blankTranslationBlock, treesFromOneTree } from './schema'
import { addFaceEntry } from './trees'
import { allEntries } from './tree'

const FACE = 'fa'
const OTHER = 'fb'

interface Said {
  unit: TranslationUnit
  blocks: TextLayerEntry[]
}

/** A sentence set in one block a side, which is what an ordinary balloon is. */
function said(id: string, face: string = FACE): Said {
  const source = blankSourceBlock(`${id}s`, DEFAULT_TEXT_STYLE)
  const translation = blankTranslationBlock(`${id}t`, face, DEFAULT_TEXT_STYLE)
  translation.body.lines = [id]
  return { unit: { id, members: [source.id, translation.id] }, blocks: [source, translation] }
}

function group(id: string, children: LayerEntry[]): GroupLayerEntry {
  return {
    kind: 'group',
    id,
    name: id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: PASS_THROUGH,
    effects: [],
    children,
  }
}

/**
 * A page one face reads; a second ledger is laid on by the tests that want one.
 * The reading is the page's own, so it is given in blocks of the artwork.
 */
function page(
  said: Said[],
  readingOrder: string[],
  readingEdges: ReadingEdge[] = [],
  extra: LayerEntry[] = [],
): ManifestJson {
  const layers = [...said.flatMap((s) => s.blocks), ...extra]
  const faces = allEntries(layers).flatMap((l) =>
    l.kind === 'text' && l.side === 'translation' ? [l.face] : [],
  )
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    ledgers: { [FACE]: { units: said.map((s) => s.unit) } },
    readingOrder,
    readingEdges,
    counters: emptyCounters(),
    ...treesFromOneTree(layers, [FACE, ...faces], FACE),
  }
}

function edges(...pairs: string[]): ReadingEdge[] {
  return pairs.map((pair) => {
    const [from, to] = pair.split('>')
    return { from, to }
  })
}

const kinds = (m: ManifestJson, faces: readonly string[] = [FACE]): string[] =>
  validatePage(m, faces).map((d) => d.kind)

describe('validatePage', () => {
  it('finds nothing wrong with a page whose order covers it exactly', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['as', 'bs']), [FACE])).toEqual([])
  })

  /** ⭐ A block the order leaves out reads last; nothing is missing. */
  it('finds nothing wrong with an order that names only some of the artwork', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['as']), [FACE])).toEqual([])
  })

  it('names an order entry no block of the artwork answers to', () => {
    const a = said('a')
    expect(validatePage(page([a], ['as', 'ghost']), [FACE])).toEqual([
      { kind: 'reading-order-dangling', id: 'ghost' },
    ])
  })

  /** ⭐ Lettering is read through the sentence holding it, never named itself. */
  it('names an order entry naming lettering rather than the artwork', () => {
    const a = said('a')
    expect(validatePage(page([a], ['as', 'at']), [FACE])).toEqual([
      { kind: 'reading-order-dangling', id: 'at' },
    ])
  })

  it('names a repeated order entry once per extra appearance', () => {
    const a = said('a')
    expect(kinds(page([a], ['as', 'as', 'as']))).toEqual(['reading-order-duplicate'])
  })

  it('names two units sharing one id', () => {
    const a = said('a')
    const twin = said('a')
    twin.blocks = []
    const m = page([a, twin], ['as'])
    expect(kinds(m)).toContain('duplicate-unit-id')
  })

  it('names two entries sharing one id', () => {
    const a = said('a')
    const m = page([a], ['as'], [], [group('as', [])])
    expect(kinds(m)).toContain('duplicate-id')
  })
})

describe('what a unit says it is made of', () => {
  it('names a member the page does not hold', () => {
    const a = said('a')
    a.unit.members = ['as', 'at', 'gone']
    const m = page([a], ['as'])
    expect(validatePage(m, [FACE])).toContainEqual({
      kind: 'unit-member-dangling',
      id: 'gone',
      unit: 'a',
      face: FACE,
    })
  })

  it('names a block two units both claim', () => {
    const a = said('a')
    const b = said('b')
    b.unit.members = ['bs', 'at', 'bt']
    const m = page([a, b], ['as', 'bs'])
    expect(kinds(m)).toContain('unit-member-shared')
  })

  it('names a unit left with nothing but artwork', () => {
    const a = said('a')
    a.blocks = [a.blocks[0]]
    a.unit.members = ['as']
    expect(validatePage(page([a], ['as']), [FACE])).toContainEqual({
      kind: 'unit-side-empty',
      id: 'a',
      side: 'translation',
      face: FACE,
    })
  })

  it('names a unit left with nothing but lettering', () => {
    const a = said('a')
    a.blocks = [a.blocks[1]]
    a.unit.members = ['at']
    expect(validatePage(page([a], []), [FACE])).toContainEqual({
      kind: 'unit-side-empty',
      id: 'a',
      side: 'source',
      face: FACE,
    })
  })

  it('names a block no unit claims at all', () => {
    const a = said('a')
    const stray = blankTranslationBlock('stray', FACE, DEFAULT_TEXT_STYLE)
    const m = page([a], ['as'], [], [stray])
    expect(validatePage(m, [FACE])).toContainEqual({
      kind: 'unit-member-orphan',
      id: 'stray',
      face: FACE,
    })
  })

  it('reports every fault it finds rather than stopping at the first', () => {
    const a = said('a')
    const b = said('b')
    a.unit.members = ['as', 'gone']
    const m = page([a, b], ['as', 'ghost'])
    expect(new Set(kinds(m))).toEqual(
      new Set([
        'unit-member-dangling',
        'unit-side-empty',
        'unit-member-orphan',
        'reading-order-dangling',
      ]),
    )
  })
})

describe('what each face sees of the page', () => {
  it('names a block of artwork one face has left out of its ledger', () => {
    const m = page([said('a'), said('b')], ['as', 'bs'])
    const theirs = blankTranslationBlock('ct', OTHER, DEFAULT_TEXT_STYLE)
    addFaceEntry(m, OTHER, theirs)
    m.ledgers[OTHER] = { units: [{ id: 'ub', members: ['as', 'ct'] }] }
    expect(validatePage(m, [FACE, OTHER])).toContainEqual({
      kind: 'unit-member-orphan',
      id: 'bs',
      face: OTHER,
    })
  })

  /** ⭐ Lettering belongs to the face that wrote it, whatever another ledger says. */
  it("names a unit holding another face's lettering", () => {
    const m = page([said('a')], ['as'])
    const theirs = blankTranslationBlock('bt', OTHER, DEFAULT_TEXT_STYLE)
    addFaceEntry(m, OTHER, theirs)
    m.ledgers[OTHER] = { units: [{ id: 'ub', members: ['as', 'at', 'bt'] }] }
    expect(validatePage(m, [FACE, OTHER])).toEqual([
      { kind: 'unit-member-foreign', id: 'at', unit: 'ub', face: OTHER },
    ])
  })

  it('finds nothing wrong with two faces that each read the page their own way', () => {
    const m = page([said('a'), said('b')], ['as', 'bs'])
    const theirs = blankTranslationBlock('ct', OTHER, DEFAULT_TEXT_STYLE)
    addFaceEntry(m, OTHER, theirs)
    m.ledgers[OTHER] = { units: [{ id: 'ub', members: ['as', 'bs', 'ct'] }] }
    expect(validatePage(m, [FACE, OTHER])).toEqual([])
  })

  it('says nothing about a face the project does not have', () => {
    const m = page([said('a')], ['as'])
    m.ledgers['gone'] = { units: [{ id: 'ub', members: ['nowhere'] }] }
    expect(validatePage(m, [FACE])).toEqual([])
  })
})

describe("the lines drawn between the artwork's words", () => {
  it('finds nothing wrong with lines between blocks that are all there', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['as', 'bs'], edges('as>bs')), [FACE])).toEqual([])
  })

  it('names a line reaching for a block that is not on the page', () => {
    const a = said('a')
    expect(validatePage(page([a], ['as'], edges('as>ghost')), [FACE])).toEqual([
      { kind: 'reading-edge-dangling', id: 'as', to: 'ghost' },
    ])
  })

  /** ⭐ Lines join the artwork's words, never lettering. */
  it('names a line reaching for lettering rather than the artwork', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['as', 'bs'], edges('as>bt')), [FACE])).toEqual([
      { kind: 'reading-edge-dangling', id: 'as', to: 'bt' },
    ])
  })

  it('names the line that closes a ring', () => {
    const a = said('a')
    const b = said('b')
    const m = page([a, b], ['as', 'bs'], edges('as>bs', 'bs>as'))
    expect(validatePage(m, [FACE])).toEqual([{ kind: 'reading-edge-cycle', id: 'bs', to: 'as' }])
  })

  it('leaves two chains that meet again alone, which is not a ring', () => {
    const a = said('a')
    const b = said('b')
    const c = said('c')
    const m = page([a, b, c], ['as', 'bs', 'cs'], edges('as>bs', 'as>cs', 'bs>cs'))
    expect(validatePage(m, [FACE])).toEqual([])
  })
})
