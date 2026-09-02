import { describe, expect, it } from 'vitest'
import type { LayerEntry, ManifestJson, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { blankBlock } from './schema'
import {
  candidateFits,
  isUntranslated,
  linesAt,
  placeOfBlock,
  projectionOf,
  shownLinesOf,
  unitsInReadingOrder,
} from './units'

function block(id: string, lines: string[]): LayerEntry {
  const entry = blankBlock(id, 'translation', DEFAULT_TEXT_STYLE)
  entry.body.lines = lines
  return entry
}

function sourceBlock(id: string, lines: string[]): LayerEntry {
  const entry = blankBlock(id, 'source', DEFAULT_TEXT_STYLE)
  entry.body.lines = lines
  return entry
}

function unit(over: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id: 'u1',
    tags: [],
    source: { members: ['s'], separators: [] },
    translation: { members: ['t'], separators: [] },
    candidates: [],
    chosen: null,
    ...over,
  }
}

function page(layers: LayerEntry[], units: TranslationUnit[]): ManifestJson {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    translationUnits: units,
    readingOrder: units.map((u) => u.id),
    readingEdges: [],
    layers,
  }
}

const SOUND = [sourceBlock('s', ['ゴゴゴ']), block('t1', ['轟']), block('t2', ['隆'])]
const SPLIT = unit({
  source: { members: ['s'], separators: [] },
  translation: { members: ['t1', 't2'], separators: [''] },
})

describe('projectionOf', () => {
  it('reads one block as the words in it', () => {
    const layers = [sourceBlock('s', ['ゴゴゴ']), block('t', ['轟隆'])]
    expect(projectionOf(layers, unit(), 'translation')).toBe('轟隆')
  })

  it('reads several blocks as one stretch, in the order the unit holds them', () => {
    expect(projectionOf(SOUND, SPLIT, 'translation')).toBe('轟隆')
  })

  it('puts the stored separator between them', () => {
    const spaced = unit({ translation: { members: ['t1', 't2'], separators: [' '] } })
    expect(projectionOf(SOUND, spaced, 'translation')).toBe('轟 隆')
  })

  /** The whole point: one sound stays one entry in the ledger. */
  it('leaves the source alone when the lettering is split', () => {
    expect(projectionOf(SOUND, SPLIT, 'source')).toBe('ゴゴゴ')
  })

  it('skips a member the page no longer holds rather than reading a gap', () => {
    const lost = unit({ translation: { members: ['t1', 'gone'], separators: ['／'] } })
    expect(projectionOf(SOUND, lost, 'translation')).toBe('轟')
  })
})

describe('linesAt', () => {
  it('reads the block own words when nothing is chosen', () => {
    expect(linesAt(unit(), 0, ['自己打的'])).toEqual(['自己打的'])
  })

  it('reads the chosen candidate piece for that block', () => {
    const picked = unit({
      translation: { members: ['t1', 't2'], separators: [''] },
      candidates: [{ id: 'c1', pieces: [['轟'], ['隆']] }],
      chosen: 'c1',
    })
    expect(linesAt(picked, 1, [''])).toEqual(['隆'])
  })

  it('falls back to the block own words when the slot names a candidate the pool lost', () => {
    expect(linesAt(unit({ chosen: 'gone' }), 0, ['留著'])).toEqual(['留著'])
  })

  it('falls back when the candidate has no piece for this block', () => {
    const short = unit({
      translation: { members: ['t1', 't2'], separators: [''] },
      candidates: [{ id: 'c1', pieces: [['轟隆']] }],
      chosen: 'c1',
    })
    expect(linesAt(short, 1, ['留著'])).toEqual(['留著'])
  })
})

describe('shownLinesOf', () => {
  it('resolves a chosen candidate for the block that shows it', () => {
    const picked = unit({
      translation: { members: ['t1', 't2'], separators: [''] },
      candidates: [{ id: 'c1', pieces: [['ぱ'], ['あ']] }],
      chosen: 'c1',
    })
    const manifest = page(SOUND, [picked])
    expect(shownLinesOf(manifest, SOUND[1] as never)).toEqual(['ぱ'])
    expect(shownLinesOf(manifest, SOUND[2] as never)).toEqual(['あ'])
  })

  /** Nobody proposes readings of the artwork, so the source says its own words. */
  it('leaves a source block reading its own words', () => {
    const manifest = page(SOUND, [SPLIT])
    expect(shownLinesOf(manifest, SOUND[0] as never)).toEqual(['ゴゴゴ'])
  })
})

describe('candidateFits', () => {
  const split = unit({
    translation: { members: ['t1', 't2'], separators: [''] },
    candidates: [
      { id: 'two', pieces: [['轟'], ['隆']] },
      { id: 'one', pieces: [['轟隆']] },
    ],
  })

  it('accepts a candidate with one piece per block', () => {
    expect(candidateFits(split, 'two')).toBe(true)
  })

  it('refuses one that would leave a piece with no block to show it', () => {
    expect(candidateFits(split, 'one')).toBe(false)
  })

  it('refuses a candidate the pool does not hold', () => {
    expect(candidateFits(split, 'gone')).toBe(false)
  })
})

describe('isUntranslated', () => {
  it('is true where every block is empty', () => {
    const layers = [sourceBlock('s', ['ゴゴゴ']), block('t', [''])]
    expect(isUntranslated(layers, unit())).toBe(true)
  })

  /** What MCP leaves behind when it fills a blank unit's slot. */
  it('is false when only the chosen candidate has words', () => {
    const layers = [sourceBlock('s', ['ゴゴゴ']), block('t', [''])]
    const picked = unit({ candidates: [{ id: 'c1', pieces: [['轟隆']] }], chosen: 'c1' })
    expect(isUntranslated(layers, picked)).toBe(false)
  })
})

describe('placeOfBlock', () => {
  it('says which unit a block says, and where in it', () => {
    const manifest = page(SOUND, [SPLIT])
    expect(placeOfBlock(manifest, 't2')).toMatchObject({ side: 'translation', at: 1 })
    expect(placeOfBlock(manifest, 's')).toMatchObject({ side: 'source', at: 0 })
  })

  it('answers nothing for a block no unit claims', () => {
    expect(placeOfBlock(page(SOUND, [SPLIT]), 'stray')).toBeUndefined()
  })
})

describe('unitsInReadingOrder', () => {
  it('follows the order and never falls back to the tree', () => {
    const a = unit({ id: 'a' })
    const b = unit({ id: 'b' })
    const manifest = { ...page(SOUND, [a, b]), readingOrder: ['b', 'a'] }
    expect(unitsInReadingOrder(manifest).map((u) => u.id)).toEqual(['b', 'a'])
  })

  it('leaves out a unit the order does not name', () => {
    const a = unit({ id: 'a' })
    const b = unit({ id: 'b' })
    const manifest = { ...page(SOUND, [a, b]), readingOrder: ['a'] }
    expect(unitsInReadingOrder(manifest).map((u) => u.id)).toEqual(['a'])
  })
})
