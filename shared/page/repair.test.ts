import { describe, expect, it } from 'vitest'
import type { GroupLayerEntry, LayerEntry, ManifestJson, TextLayerEntry, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { repairPage } from './repair'
import { validatePage } from './validate'
import { textObjects } from './tree'
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
  units: Said[],
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
    ledgers: { [FACE]: { units: units.map((s) => s.unit), readingOrder, readingEdges } },
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
    const { manifest, repaired } = repairPage(m, [FACE], counter())
    expect(repaired).toEqual([])
    expect(manifest.ledgers[FACE].readingOrder).toEqual(['a', 'b'])
    expect(validatePage(manifest, [FACE])).toEqual([])
  })

  it('puts an unmentioned sentence at the end of the order', () => {
    const m = page([said('a'), said('b')], ['a'])
    const { manifest, repaired } = repairPage(m, [FACE], counter())
    expect(manifest.ledgers[FACE].readingOrder).toEqual(['a', 'b'])
    expect(repaired).toEqual([{ kind: 'reading-order-missing', id: 'b', face: FACE }])
  })

  it('drops an order entry that lands on nothing', () => {
    const { manifest } = repairPage(page([said('a')], ['a', 'ghost']), [FACE], counter())
    expect(manifest.ledgers[FACE].readingOrder).toEqual(['a'])
  })

  it('keeps the first of a repeated entry and drops the rest', () => {
    const { manifest } = repairPage(page([said('a')], ['a', 'a']), [FACE], counter())
    expect(manifest.ledgers[FACE].readingOrder).toEqual(['a'])
  })

  it('renames the later of two entries sharing an id', () => {
    const a = said('a')
    const m = page([a], ['a'], [], [group('as', [])])
    const { manifest, repaired } = repairPage(m, [FACE], counter())
    expect(repaired.map((d) => d.kind)).toContain('duplicate-id')
    const ids = textObjects(manifest.layers).map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('answers with a page nothing is left to say about', () => {
    const a = said('a')
    a.unit.members = ['as', 'ghost']
    const m = page([a], ['a', 'ghost'], edges('a>ghost'))
    const { manifest } = repairPage(m, [FACE], counter())
    expect(validatePage(manifest, [FACE])).toEqual([])
  })

  it('does not write over the page it was given', () => {
    const m = page([said('a'), said('b')], ['a'])
    const before = JSON.stringify(m)
    repairPage(m, [FACE], counter())
    expect(JSON.stringify(m)).toBe(before)
  })
})

describe('repairing what a unit says it is made of', () => {
  it('takes out a member the page no longer holds and leaves the rest in order', () => {
    const a = said('a')
    const second = blankTranslationBlock('at2', FACE, DEFAULT_TEXT_STYLE)
    a.blocks.push(second)
    a.unit.members = ['as', 'at', 'gone', 'at2']
    const { manifest, repaired } = repairPage(page([a], ['a']), [FACE], counter())
    expect(manifest.ledgers[FACE].units[0].members).toEqual(['as', 'at', 'at2'])
    expect(repaired).toEqual([{ kind: 'unit-member-dangling', id: 'gone', unit: 'a', face: FACE }])
    expect(validatePage(manifest, [FACE])).toEqual([])
  })

  it('leaves one claim on a block two units both named', () => {
    const a = said('a')
    const b = said('b')
    b.unit.members = ['bs', 'at', 'bt']
    const { manifest } = repairPage(page([a, b], ['a', 'b']), [FACE], counter())
    const claims = manifest.ledgers[FACE].units.flatMap((u) => u.members)
    expect(claims.filter((id) => id === 'at')).toHaveLength(1)
    expect(validatePage(manifest, [FACE])).toEqual([])
  })

  /**
   * ⭐ Not a guess about content: the invariant says a side has a block, so what
   * arrives is an empty one standing where its counterpart stands.
   */
  it('gives an emptied side a blank block rather than deleting the sentence', () => {
    const a = said('a')
    a.blocks[0].body.x = 40
    a.blocks[0].body.y = 90
    a.blocks = [a.blocks[0]]
    a.unit.members = ['as']
    const { manifest, repaired } = repairPage(page([a], ['a']), [FACE], counter())
    expect(repaired).toEqual([{ kind: 'unit-side-empty', id: 'a', side: 'translation', face: FACE }])
    const unit = manifest.ledgers[FACE].units[0]
    expect(unit.members).toHaveLength(2)
    const mate = textObjects(manifest.layers).find((t) => t.id === unit.members[1])
    expect(mate).toMatchObject({ side: 'translation', face: FACE })
    expect(mate?.body).toMatchObject({ x: 40, y: 90, lines: [''] })
  })

  it('gives a unit left holding only lettering a blank block of artwork', () => {
    const a = said('a')
    a.blocks = [a.blocks[1]]
    a.unit.members = ['at']
    const { manifest, repaired } = repairPage(page([a], ['a']), [FACE], counter())
    expect(repaired).toEqual([{ kind: 'unit-side-empty', id: 'a', side: 'source', face: FACE }])
    const unit = manifest.ledgers[FACE].units[0]
    expect(unit.members[1]).toBe('at')
    expect(textObjects(manifest.layers).find((t) => t.id === unit.members[0])?.side).toBe('source')
    expect(validatePage(manifest, [FACE])).toEqual([])
  })

  /** ⛔ Never folded into a neighbour: position and matching words are not evidence. */
  it('stands a block no unit claims up as its own sentence', () => {
    const a = said('a')
    const stray = blankTranslationBlock('stray', FACE, DEFAULT_TEXT_STYLE)
    const { manifest } = repairPage(page([a], ['a'], [], [stray]), [FACE], counter())
    const ledger = manifest.ledgers[FACE]
    expect(ledger.units).toHaveLength(2)
    const own = ledger.units.find((u) => u.members.includes('stray'))
    expect(own?.members).toHaveLength(2)
    expect(textObjects(manifest.layers).find((t) => t.id === own?.members[0])?.side).toBe('source')
    expect(ledger.readingOrder).toContain(own?.id)
    expect(validatePage(manifest, [FACE])).toEqual([])
  })
})

describe('repairing a page more than one face reads', () => {
  it('gives a face with no ledger of its own a sentence per block of artwork', () => {
    const m = page([said('a')], ['a'])
    const { manifest, repaired } = repairPage(m, [FACE, OTHER], counter())
    expect(repaired).toEqual([
      { kind: 'unit-member-orphan', id: 'as', face: OTHER },
      { kind: 'reading-order-missing', id: expect.any(String), face: OTHER },
    ])
    const ledger = manifest.ledgers[OTHER]
    expect(ledger.units).toHaveLength(1)
    expect(ledger.units[0].members[0]).toBe('as')
    expect(ledger.readingOrder).toEqual([ledger.units[0].id])
    expect(manifest.ledgers[FACE].units).toEqual([{ id: 'a', members: ['as', 'at'] }])
    expect(validatePage(manifest, [FACE, OTHER])).toEqual([])
  })

  it('gives a block of artwork one face left out its own unit and lettering there', () => {
    const a = said('a')
    const b = said('b')
    b.blocks[0].body.x = 70
    const m = page([a, b], ['a', 'b'])
    const theirs = blankTranslationBlock('ct', OTHER, DEFAULT_TEXT_STYLE)
    m.layers.push(theirs)
    m.ledgers[OTHER] = {
      units: [{ id: 'ub', members: ['as', 'ct'] }],
      readingOrder: ['ub'],
      readingEdges: [],
    }
    const { manifest, repaired } = repairPage(m, [FACE, OTHER], counter())
    expect(repaired).toEqual([
      { kind: 'unit-member-orphan', id: 'bs', face: OTHER },
      { kind: 'reading-order-missing', id: expect.any(String), face: OTHER },
    ])
    const ledger = manifest.ledgers[OTHER]
    expect(ledger.units).toHaveLength(2)
    const own = ledger.units.find((u) => u.members.includes('bs'))!
    expect(own.members).toHaveLength(2)
    const mate = textObjects(manifest.layers).find((t) => t.id === own.members[1])
    expect(mate).toMatchObject({ side: 'translation', face: OTHER })
    expect(mate?.body).toMatchObject({ x: 70, lines: [''] })
    expect(manifest.ledgers[FACE].units).toHaveLength(2)
    expect(validatePage(manifest, [FACE, OTHER])).toEqual([])
  })

  it("takes another face's lettering out of a unit and leaves its own alone", () => {
    const m = page([said('a')], ['a'])
    const theirs = blankTranslationBlock('bt', OTHER, DEFAULT_TEXT_STYLE)
    m.layers.push(theirs)
    m.ledgers[OTHER] = {
      units: [{ id: 'ub', members: ['as', 'at', 'bt'] }],
      readingOrder: ['ub'],
      readingEdges: [],
    }
    const { manifest, repaired } = repairPage(m, [FACE, OTHER], counter())
    expect(repaired).toEqual([
      { kind: 'unit-member-foreign', id: 'at', unit: 'ub', face: OTHER },
    ])
    expect(manifest.ledgers[OTHER].units).toEqual([{ id: 'ub', members: ['as', 'bt'] }])
    expect(manifest.ledgers[FACE].units).toEqual([{ id: 'a', members: ['as', 'at'] }])
    expect(validatePage(manifest, [FACE, OTHER])).toEqual([])
  })

  /** ⭐ A blank block one face needed is a block every other face has to place too. */
  it('mends a block of artwork two units of one face claim, and seats the blank in the other', () => {
    const a = said('a')
    const b = said('b')
    const m = page([a, b], ['a', 'b'])
    const mine = blankTranslationBlock('ct', OTHER, DEFAULT_TEXT_STYLE)
    const theirs = blankTranslationBlock('dt', OTHER, DEFAULT_TEXT_STYLE)
    m.layers.push(mine, theirs)
    m.ledgers[OTHER] = {
      units: [
        { id: 'uc', members: ['as', 'bs', 'ct'] },
        { id: 'ud', members: ['bs', 'dt'] },
      ],
      readingOrder: ['uc', 'ud'],
      readingEdges: [],
    }
    const { manifest, repaired } = repairPage(m, [FACE, OTHER], counter())
    expect(manifest.ledgers[OTHER].units).toEqual([
      { id: 'uc', members: ['as', 'bs', 'ct'] },
      { id: 'ud', members: [expect.any(String), 'dt'] },
    ])
    const blank = manifest.ledgers[OTHER].units[1].members[0]
    expect(repaired).toEqual([
      { kind: 'unit-member-shared', id: 'bs', unit: 'ud', face: OTHER },
      { kind: 'unit-side-empty', id: 'ud', side: 'source', face: OTHER },
      { kind: 'unit-member-orphan', id: blank, face: FACE },
      { kind: 'reading-order-missing', id: expect.any(String), face: FACE },
    ])
    expect(manifest.ledgers[FACE].units).toHaveLength(3)
    expect(manifest.ledgers[FACE].units[2].members[0]).toBe(blank)
    expect(validatePage(manifest, [FACE, OTHER])).toEqual([])
  })
})

describe('repairing the lines drawn between sentences', () => {
  it('leaves sound lines exactly as they were', () => {
    const m = page([said('a'), said('b')], ['a', 'b'], edges('a>b'))
    const { manifest, repaired } = repairPage(m, [FACE], counter())
    expect(manifest.ledgers[FACE].readingEdges).toEqual(edges('a>b'))
    expect(repaired).toEqual([])
  })

  it('drops a line reaching for a sentence that is not on the page', () => {
    const m = page([said('a')], ['a'], edges('a>ghost'))
    const { manifest, repaired } = repairPage(m, [FACE], counter())
    expect(manifest.ledgers[FACE].readingEdges).toEqual([])
    expect(repaired).toEqual([{ kind: 'reading-edge-dangling', id: 'a', to: 'ghost', face: FACE }])
  })

  it('opens the ring rather than refusing the page', () => {
    const m = page([said('a'), said('b')], ['a', 'b'], edges('a>b', 'b>a'))
    const { manifest, repaired } = repairPage(m, [FACE], counter())
    expect(manifest.ledgers[FACE].readingEdges).toEqual(edges('a>b'))
    expect(repaired).toEqual([{ kind: 'reading-edge-cycle', id: 'b', to: 'a', face: FACE }])
  })

  it('leaves a page whose lines meet again untouched', () => {
    const m = page([said('a'), said('b'), said('c')], ['a', 'b', 'c'], edges('a>b', 'a>c', 'b>c'))
    const { manifest, repaired } = repairPage(m, [FACE], counter())
    expect(manifest.ledgers[FACE].readingEdges).toEqual(edges('a>b', 'a>c', 'b>c'))
    expect(repaired).toEqual([])
  })

  it('mends one face\u2019s lines without touching another\u2019s', () => {
    const m = page([said('a'), said('b')], ['a', 'b'], edges('a>b'))
    const mine = blankTranslationBlock('ct', OTHER, DEFAULT_TEXT_STYLE)
    const theirs = blankTranslationBlock('dt', OTHER, DEFAULT_TEXT_STYLE)
    m.layers.push(mine, theirs)
    m.ledgers[OTHER] = {
      units: [
        { id: 'uc', members: ['as', 'ct'] },
        { id: 'ud', members: ['bs', 'dt'] },
      ],
      readingOrder: ['uc', 'ud'],
      readingEdges: edges('uc>ud', 'ud>uc'),
    }
    const { manifest, repaired } = repairPage(m, [FACE, OTHER], counter())
    expect(repaired).toEqual([{ kind: 'reading-edge-cycle', id: 'ud', to: 'uc', face: OTHER }])
    expect(manifest.ledgers[FACE].readingEdges).toEqual(edges('a>b'))
    expect(manifest.ledgers[OTHER].readingEdges).toEqual(edges('uc>ud'))
  })
})
