import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, TextLayerEntry, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { validatePage } from './validate'
import type { ReadingEdge } from './readingGraph'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { blankSourceBlock, blankTranslationBlock } from './schema'

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

/** A page one face reads; a second ledger is laid on by the tests that want one. */
function page(
  said: Said[],
  readingOrder: string[],
  readingEdges: ReadingEdge[] = [],
  extra: LayerEntry[] = [],
): ManifestJson {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    ledgers: { [FACE]: { units: said.map((s) => s.unit), readingOrder, readingEdges } },
    layers: [...said.flatMap((s) => s.blocks), ...extra],
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
    expect(validatePage(page([a, b], ['a', 'b']), [FACE])).toEqual([])
  })

  it('names a sentence the order never mentions', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['a']), [FACE])).toEqual([
      { kind: 'reading-order-missing', id: 'b', face: FACE },
    ])
  })

  it('names an order entry no sentence answers to', () => {
    const a = said('a')
    expect(validatePage(page([a], ['a', 'ghost']), [FACE])).toEqual([
      { kind: 'reading-order-dangling', id: 'ghost', face: FACE },
    ])
  })

  it('names a repeated order entry once per extra appearance', () => {
    const a = said('a')
    expect(kinds(page([a], ['a', 'a', 'a']))).toEqual(['reading-order-duplicate'])
  })

  it('names two units sharing one id', () => {
    const a = said('a')
    const twin = said('a')
    twin.blocks = []
    const m = page([a, twin], ['a'])
    expect(kinds(m)).toContain('duplicate-unit-id')
  })

  it('names two entries sharing one id', () => {
    const a = said('a')
    const m = page([a], ['a'], [], [group('as', [])])
    expect(kinds(m)).toContain('duplicate-id')
  })
})

describe('what a unit says it is made of', () => {
  it('names a member the page does not hold', () => {
    const a = said('a')
    a.unit.members = ['as', 'at', 'gone']
    const m = page([a], ['a'])
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
    const m = page([a, b], ['a', 'b'])
    expect(kinds(m)).toContain('unit-member-shared')
  })

  it('names a unit left with nothing but artwork', () => {
    const a = said('a')
    a.blocks = [a.blocks[0]]
    a.unit.members = ['as']
    expect(validatePage(page([a], ['a']), [FACE])).toContainEqual({
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
    expect(validatePage(page([a], ['a']), [FACE])).toContainEqual({
      kind: 'unit-side-empty',
      id: 'a',
      side: 'source',
      face: FACE,
    })
  })

  it('names a block no unit claims at all', () => {
    const a = said('a')
    const stray = blankTranslationBlock('stray', FACE, DEFAULT_TEXT_STYLE)
    const m = page([a], ['a'], [], [stray])
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
    const m = page([a, b], ['a', 'ghost'])
    expect(new Set(kinds(m))).toEqual(
      new Set([
        'unit-member-dangling',
        'unit-side-empty',
        'unit-member-orphan',
        'reading-order-dangling',
        'reading-order-missing',
      ]),
    )
  })
})

describe('what each face sees of the page', () => {
  it('names a block of artwork one face has left out of its ledger', () => {
    const m = page([said('a'), said('b')], ['a', 'b'])
    const theirs = blankTranslationBlock('ct', OTHER, DEFAULT_TEXT_STYLE)
    m.layers.push(theirs)
    m.ledgers[OTHER] = {
      units: [{ id: 'ub', members: ['as', 'ct'] }],
      readingOrder: ['ub'],
      readingEdges: [],
    }
    expect(validatePage(m, [FACE, OTHER])).toContainEqual({
      kind: 'unit-member-orphan',
      id: 'bs',
      face: OTHER,
    })
  })

  /** ⭐ Lettering belongs to the face that wrote it, whatever another ledger says. */
  it("names a unit holding another face's lettering", () => {
    const m = page([said('a')], ['a'])
    const theirs = blankTranslationBlock('bt', OTHER, DEFAULT_TEXT_STYLE)
    m.layers.push(theirs)
    m.ledgers[OTHER] = {
      units: [{ id: 'ub', members: ['as', 'at', 'bt'] }],
      readingOrder: ['ub'],
      readingEdges: [],
    }
    expect(validatePage(m, [FACE, OTHER])).toEqual([
      { kind: 'unit-member-foreign', id: 'at', unit: 'ub', face: OTHER },
    ])
  })

  it('finds nothing wrong with two faces that each read the page their own way', () => {
    const m = page([said('a'), said('b')], ['a', 'b'])
    const theirs = blankTranslationBlock('ct', OTHER, DEFAULT_TEXT_STYLE)
    m.layers.push(theirs)
    m.ledgers[OTHER] = {
      units: [{ id: 'ub', members: ['as', 'bs', 'ct'] }],
      readingOrder: ['ub'],
      readingEdges: [],
    }
    expect(validatePage(m, [FACE, OTHER])).toEqual([])
  })

  it('says nothing about a face the project does not have', () => {
    const m = page([said('a')], ['a'])
    m.ledgers['gone'] = { units: [{ id: 'ub', members: ['nowhere'] }], readingOrder: [], readingEdges: [] }
    expect(validatePage(m, [FACE])).toEqual([])
  })
})

describe('the lines drawn between sentences', () => {
  it('finds nothing wrong with lines between units that are all there', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['a', 'b'], edges('a>b')), [FACE])).toEqual([])
  })

  it('names a line reaching for a unit that is not on the page', () => {
    const a = said('a')
    expect(validatePage(page([a], ['a'], edges('a>ghost')), [FACE])).toEqual([
      { kind: 'reading-edge-dangling', id: 'a', to: 'ghost', face: FACE },
    ])
  })

  /** ⭐ A block is not a unit: lines join sentences, not lettering. */
  it('names a line reaching for a block rather than a sentence', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['a', 'b'], edges('a>bt')), [FACE])).toEqual([
      { kind: 'reading-edge-dangling', id: 'a', to: 'bt', face: FACE },
    ])
  })

  it('names the line that closes a ring', () => {
    const a = said('a')
    const b = said('b')
    const m = page([a, b], ['a', 'b'], edges('a>b', 'b>a'))
    expect(validatePage(m, [FACE])).toEqual([{ kind: 'reading-edge-cycle', id: 'b', to: 'a', face: FACE }])
  })

  it('leaves two chains that meet again alone, which is not a ring', () => {
    const a = said('a')
    const b = said('b')
    const c = said('c')
    const m = page([a, b, c], ['a', 'b', 'c'], edges('a>b', 'a>c', 'b>c'))
    expect(validatePage(m, [FACE])).toEqual([])
  })
})
