import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { validatePage } from './validate'
import type { ReadingEdge } from './readingGraph'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { blankBlock } from './schema'

/** A translation set in one block a side, which is what an ordinary balloon is. */
function said(id: string): { unit: TranslationUnit; blocks: LayerEntry[] } {
  const source = blankBlock(`${id}s`, 'source', DEFAULT_TEXT_STYLE)
  const translation = blankBlock(`${id}t`, 'translation', DEFAULT_TEXT_STYLE)
  translation.body.lines = [id]
  return {
    unit: {
      id,
      tags: [],
      source: { members: [source.id], separators: [] },
      translation: { members: [translation.id], separators: [] },
      candidates: [],
      chosen: null,
    },
    blocks: [source, translation],
  }
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

function page(
  said: { unit: TranslationUnit; blocks: LayerEntry[] }[],
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
    translationUnits: said.map((s) => s.unit),
    readingOrder,
    readingEdges,
    layers: [...said.flatMap((s) => s.blocks), ...extra],
  }
}

function edges(...pairs: string[]): ReadingEdge[] {
  return pairs.map((pair) => {
    const [from, to] = pair.split('>')
    return { from, to }
  })
}

const kinds = (m: ManifestJson): string[] => validatePage(m).map((d) => d.kind)

describe('validatePage', () => {
  it('finds nothing wrong with a page whose order covers it exactly', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['a', 'b']))).toEqual([])
  })

  it('names a translation the order never mentions', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['a']))).toEqual([
      { kind: 'reading-order-missing', id: 'b' },
    ])
  })

  it('names an order entry no translation answers to', () => {
    const a = said('a')
    expect(validatePage(page([a], ['a', 'ghost']))).toEqual([
      { kind: 'reading-order-dangling', id: 'ghost' },
    ])
  })

  it('names a repeated order entry once per extra appearance', () => {
    const a = said('a')
    expect(kinds(page([a], ['a', 'a', 'a']))).toEqual(['reading-order-duplicate'])
  })

  it('names two units sharing one id', () => {
    const a = said('a')
    const twin = said('a')
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
    a.unit.translation.members = ['gone']
    const m = page([a], ['a'])
    expect(kinds(m)).toContain('unit-member-dangling')
  })

  it('names a source list holding a block of lettering', () => {
    const a = said('a')
    a.unit.source.members = ['at']
    const m = page([a], ['a'])
    expect(kinds(m)).toContain('unit-member-side-mismatch')
  })

  it('names a block two units both claim', () => {
    const a = said('a')
    const b = said('b')
    b.unit.translation.members = ['at']
    const m = page([a, b], ['a', 'b'])
    expect(kinds(m)).toContain('unit-member-shared')
  })

  it('names a side a unit has nothing left in', () => {
    const a = said('a')
    a.unit.translation.members = ['gone']
    expect(validatePage(page([a], ['a']))).toContainEqual({
      kind: 'unit-side-empty',
      id: 'a',
      side: 'translation',
    })
  })

  it('names a block no unit claims at all', () => {
    const a = said('a')
    const stray = blankBlock('stray', 'translation', DEFAULT_TEXT_STYLE)
    const m = page([a], ['a'], [], [stray])
    expect(validatePage(m)).toContainEqual({ kind: 'unit-member-orphan', id: 'stray' })
  })

  it('reports every fault it finds rather than stopping at the first', () => {
    const a = said('a')
    const b = said('b')
    a.unit.translation.members = ['gone']
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

describe('the lines drawn between translations', () => {
  it('finds nothing wrong with lines between units that are all there', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['a', 'b'], edges('a>b')))).toEqual([])
  })

  it('names a line reaching for a unit that is not on the page', () => {
    const a = said('a')
    expect(validatePage(page([a], ['a'], edges('a>ghost')))).toEqual([
      { kind: 'reading-edge-dangling', id: 'a', to: 'ghost' },
    ])
  })

  /** ⭐ A block is not a unit: lines join content, not lettering. */
  it('names a line reaching for a block rather than a translation', () => {
    const a = said('a')
    const b = said('b')
    expect(validatePage(page([a, b], ['a', 'b'], edges('a>bt')))).toEqual([
      { kind: 'reading-edge-dangling', id: 'a', to: 'bt' },
    ])
  })

  it('names the line that closes a ring', () => {
    const a = said('a')
    const b = said('b')
    const m = page([a, b], ['a', 'b'], edges('a>b', 'b>a'))
    expect(validatePage(m)).toEqual([{ kind: 'reading-edge-cycle', id: 'b', to: 'a' }])
  })

  it('leaves two chains that meet again alone, which is not a ring', () => {
    const a = said('a')
    const b = said('b')
    const c = said('c')
    const m = page([a, b, c], ['a', 'b', 'c'], edges('a>b', 'a>c', 'b>c'))
    expect(validatePage(m)).toEqual([])
  })
})
