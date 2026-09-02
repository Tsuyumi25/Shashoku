import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { repairPage } from './repair'
import { validatePage } from './validate'
import { textObjects } from './tree'
import type { ReadingEdge } from './readingGraph'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { blankBlock } from './schema'

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
  units: { unit: TranslationUnit; blocks: LayerEntry[] }[],
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
    translationUnits: units.map((s) => s.unit),
    readingOrder,
    readingEdges,
    layers: [...units.flatMap((s) => s.blocks), ...extra],
  }
}

function edges(...pairs: string[]): ReadingEdge[] {
  return pairs.map((pair) => {
    const [from, to] = pair.split('>')
    return { from, to }
  })
}

/** A fixed pen, so a repaired page reads the same way twice. */
function counter(): () => string {
  let n = 0
  return () => `new${(n += 1)}`
}

describe('repairPage', () => {
  it('leaves a sound page exactly as it was', () => {
    const m = page([said('a'), said('b')], ['a', 'b'])
    const { manifest, repaired } = repairPage(m, counter())
    expect(repaired).toEqual([])
    expect(manifest.readingOrder).toEqual(['a', 'b'])
    expect(validatePage(manifest)).toEqual([])
  })

  it('puts an unmentioned translation at the end of the order', () => {
    const m = page([said('a'), said('b')], ['a'])
    const { manifest, repaired } = repairPage(m, counter())
    expect(manifest.readingOrder).toEqual(['a', 'b'])
    expect(repaired).toEqual([{ kind: 'reading-order-missing', id: 'b' }])
  })

  it('drops an order entry that lands on nothing', () => {
    const { manifest } = repairPage(page([said('a')], ['a', 'ghost']), counter())
    expect(manifest.readingOrder).toEqual(['a'])
  })

  it('keeps the first of a repeated entry and drops the rest', () => {
    const { manifest } = repairPage(page([said('a')], ['a', 'a']), counter())
    expect(manifest.readingOrder).toEqual(['a'])
  })

  it('renames the later of two entries sharing an id', () => {
    const a = said('a')
    const m = page([a], ['a'], [], [group('as', [])])
    const { manifest, repaired } = repairPage(m, counter())
    expect(repaired.map((d) => d.kind)).toContain('duplicate-id')
    const ids = textObjects(manifest.layers).map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('answers with a page nothing is left to say about', () => {
    const a = said('a')
    a.unit.translation.members = ['gone']
    const m = page([a], ['a', 'ghost'], edges('a>ghost'))
    const { manifest } = repairPage(m, counter())
    expect(validatePage(manifest)).toEqual([])
  })

  it('does not write over the page it was given', () => {
    const m = page([said('a'), said('b')], ['a'])
    const before = JSON.stringify(m)
    repairPage(m, counter())
    expect(JSON.stringify(m)).toBe(before)
  })
})

describe('repairing what a unit says it is made of', () => {
  it('takes out a member the page no longer holds, and the gap beside it', () => {
    const a = said('a')
    const second = blankBlock('at2', 'translation', DEFAULT_TEXT_STYLE)
    a.blocks.push(second)
    a.unit.translation = { members: ['at', 'gone', 'at2'], separators: ['／', '、'] }
    const { manifest } = repairPage(page([a], ['a']), counter())
    const unit = manifest.translationUnits[0]
    expect(unit.translation.members).toEqual(['at', 'at2'])
    expect(unit.translation.separators).toHaveLength(1)
    expect(validatePage(manifest)).toEqual([])
  })

  it('leaves one claim on a block two units both named', () => {
    const a = said('a')
    const b = said('b')
    b.unit.translation.members = ['at']
    const { manifest } = repairPage(page([a, b], ['a', 'b']), counter())
    const claims = manifest.translationUnits.flatMap((u) => u.translation.members)
    expect(claims.filter((id) => id === 'at')).toHaveLength(1)
    expect(validatePage(manifest)).toEqual([])
  })

  /**
   * ⭐ Not a guess about content: the invariant says a side has a block, so what
   * arrives is an empty one standing where its counterpart stands.
   */
  it('gives an emptied side a blank block rather than deleting the translation', () => {
    const a = said('a')
    const artwork = a.blocks[0]
    if (artwork.kind !== 'text') throw new Error('unreachable')
    artwork.body.x = 40
    artwork.body.y = 90
    a.unit.translation.members = ['gone']
    const { manifest, repaired } = repairPage(page([a], ['a']), counter())
    expect(repaired.map((d) => d.kind)).toContain('unit-side-empty')
    const unit = manifest.translationUnits[0]
    expect(unit.translation.members).toHaveLength(1)
    const block = textObjects(manifest.layers).find((t) => t.id === unit.translation.members[0])
    expect(block?.body).toMatchObject({ x: 40, y: 90, lines: [''] })
  })

  /** ⛔ Never folded into a neighbour: position and matching words are not evidence. */
  it('stands a block no unit claims up as its own translation', () => {
    const a = said('a')
    const stray = blankBlock('stray', 'translation', DEFAULT_TEXT_STYLE)
    const { manifest } = repairPage(page([a], ['a'], [], [stray]), counter())
    expect(manifest.translationUnits).toHaveLength(2)
    const own = manifest.translationUnits.find((u) => u.translation.members.includes('stray'))
    expect(own?.source.members).toHaveLength(1)
    expect(manifest.readingOrder).toContain(own?.id)
    expect(validatePage(manifest)).toEqual([])
  })

  it('lets go of a chosen candidate that no longer has a piece per block', () => {
    const a = said('a')
    const second = blankBlock('at2', 'translation', DEFAULT_TEXT_STYLE)
    a.blocks.push(second)
    a.unit.translation = { members: ['at', 'at2'], separators: [''] }
    a.unit.candidates = [{ id: 'c1', pieces: [['轟隆']] }]
    a.unit.chosen = 'c1'
    const { manifest } = repairPage(page([a], ['a']), counter())
    expect(manifest.translationUnits[0].chosen).toBeNull()
    expect(manifest.translationUnits[0].candidates).toHaveLength(1)
  })
})

describe('repairing the lines drawn between translations', () => {
  it('leaves sound lines exactly as they were', () => {
    const m = page([said('a'), said('b')], ['a', 'b'], edges('a>b'))
    const { manifest, repaired } = repairPage(m, counter())
    expect(manifest.readingEdges).toEqual(edges('a>b'))
    expect(repaired).toEqual([])
  })

  it('drops a line reaching for a translation that is not on the page', () => {
    const m = page([said('a')], ['a'], edges('a>ghost'))
    const { manifest, repaired } = repairPage(m, counter())
    expect(manifest.readingEdges).toEqual([])
    expect(repaired).toEqual([{ kind: 'reading-edge-dangling', id: 'a', to: 'ghost' }])
  })

  it('opens the ring rather than refusing the page', () => {
    const m = page([said('a'), said('b')], ['a', 'b'], edges('a>b', 'b>a'))
    const { manifest, repaired } = repairPage(m, counter())
    expect(manifest.readingEdges).toEqual(edges('a>b'))
    expect(repaired).toEqual([{ kind: 'reading-edge-cycle', id: 'b', to: 'a' }])
  })

  it('leaves a page whose lines meet again untouched', () => {
    const m = page(
      [said('a'), said('b'), said('c')],
      ['a', 'b', 'c'],
      edges('a>b', 'a>c', 'b>c'),
    )
    const { manifest, repaired } = repairPage(m, counter())
    expect(manifest.readingEdges).toEqual(edges('a>b', 'a>c', 'b>c'))
    expect(repaired).toEqual([])
  })
})
