import { describe, expect, it } from 'vitest'
import type {
  LayerEntry,
  ManifestJson,
  SourceTextLayerEntry,
  TranslationTextLayerEntry,
  TranslationUnit,
} from './types'
import { MANIFEST_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { emptyCounters } from './numbers'
import { blankSourceBlock, blankTranslationBlock, treesFromOneTree } from './schema'
import { adoptSources, detach, planRelink, relink } from './relink'
import { blocksOf, facePage, shownCodeOf, translationBlocksOf, unitsInReadingOrder, type FacePage } from './units'
import { findTextObject } from './tree'
import { everyEntry, textOnPage } from './trees'
import { validatePage } from './validate'

const FACE = 'f'
const OTHER = 'g'

function src(id: string, text: string): SourceTextLayerEntry {
  const entry = blankSourceBlock(id, DEFAULT_TEXT_STYLE)
  entry.body.lines = [text]
  return entry
}

function tr(id: string, text: string, face = FACE): TranslationTextLayerEntry {
  const entry = blankTranslationBlock(id, face, DEFAULT_TEXT_STYLE)
  entry.body.lines = [text]
  return entry
}

function unit(id: string, members: string[]): TranslationUnit {
  return { id, members }
}

function manifestOf(layers: LayerEntry[], ledgers: Record<string, TranslationUnit[]>): ManifestJson {
  const faces = Object.keys(ledgers)
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    ledgers: Object.fromEntries(Object.entries(ledgers).map(([face, units]) => [face, { units }])),
    readingOrder: [],
    readingEdges: [],
    counters: emptyCounters(),
    ...treesFromOneTree(layers, faces, faces[0]),
  }
}

let n = 0
const newId = () => `new${++n}`

/** Each sentence as "source | translation", in reading order, a block with no words as □. */
function read(page: FacePage): string[] {
  const words = (ids: readonly { id: string }[]) =>
    ids.map((block) => shownCodeOf(findTextObject(page.layers, block.id)!) || '□').join('、')
  return unitsInReadingOrder(page).map(
    (u) => `${words(blocksOf(page, u, 'source'))} | ${words(blocksOf(page, u, 'translation'))}`,
  )
}

const GASPS = [
  ['s1', 'はぁ', '哈', 'ハ'],
  ['s2', 'はっ', '哈', 'ハ'],
  ['s3', 'れろ', '舔', 'ペロ'],
  ['s4', '', '嗯', 'ん'],
] as const

/**
 * Three gasps, each its own sentence, and one sentence put down from a material
 * with no source yet — lettered by every face asked for.
 */
function gasps(faces: readonly string[] = [FACE]): ManifestJson {
  const layers: LayerEntry[] = GASPS.map(([id, text]) => src(id, text))
  const ledgers: Record<string, TranslationUnit[]> = {}
  for (const face of faces) {
    const mark = face === FACE ? '' : face
    ledgers[face] = GASPS.map(([id, , own, other], i) => {
      const block = tr(`${mark}t${i + 1}`, face === FACE ? own : other, face)
      layers.push(block)
      return unit(`${mark}u${i + 1}`, [id, block.id])
    })
  }
  return manifestOf(layers, ledgers)
}

describe('Ctrl+L', () => {
  it('folds the sentences of blocks selected on one side into the first in reading order, both sides travelling', () => {
    const m = gasps()
    const page = facePage(m, FACE)
    expect(relink(page, ['t2', 't1'], newId, DEFAULT_TEXT_STYLE)).toBe(true)
    expect(read(page)).toEqual(['はぁ、はっ | 哈、哈', 'れろ | 舔', '□ | 嗯'])
    expect(validatePage(m, [FACE])).toEqual([])
  })

  it('pairs across sides by moving only what was selected, keeping what the sentence already had', () => {
    const m = gasps()
    const page = facePage(m, FACE)
    relink(page, ['t4', 's3'], newId, DEFAULT_TEXT_STYLE)
    // The material's sentence had nothing else real, so it is gone.
    expect(read(page)).toEqual(['はぁ | 哈', 'はっ | 哈', 'れろ | 舔、嗯'])
    expect(textOnPage(m, 's4')).toBeUndefined()
    expect(validatePage(m, [FACE])).toEqual([])
  })

  it('leaves a blank behind on the side a pairing emptied, so the sentence it left stays whole', () => {
    const m = gasps()
    const page = facePage(m, FACE)
    relink(page, ['t2', 's1'], newId, DEFAULT_TEXT_STYLE)
    expect(read(page)).toEqual(['はぁ | 哈、哈', 'はっ | □', 'れろ | 舔', '□ | 嗯'])
    expect(validatePage(m, [FACE])).toEqual([])
  })

  it('does nothing for blocks already in one sentence', () => {
    const page = facePage(gasps(), FACE)
    expect(planRelink(page, ['s1', 't1'])).toEqual({ kind: 'none' })
    expect(relink(page, ['t1'], newId, DEFAULT_TEXT_STYLE)).toBe(false)
  })

  /** Shown text decides what is a placeholder, so a block reading a proposal keeps its place. */
  it('keeps a block that reads only through its chosen candidate, losing no word', () => {
    const m = gasps()
    const page = facePage(m, FACE)
    const block = textOnPage(m, 't1') as TranslationTextLayerEntry
    block.body.lines = ['']
    block.body.candidates = [{ id: 'c', lines: ['哈啊'] }]
    block.body.chosen = 'c'

    relink(page, ['t2', 't1'], newId, DEFAULT_TEXT_STYLE)

    expect(read(page)[0]).toBe('はぁ、はっ | 哈啊、哈')
    expect(block.body.chosen).toBe('c')
  })

  /**
   * ⭐ Nothing is rewritten: the lines belong to the artwork, and folding two
   * sentences into one only changes what this face sees of them.
   */
  it('leaves the lines where they were, so one into a folded sentence reads from the one it joined', () => {
    const m = gasps()
    const page = facePage(m, FACE)
    m.readingEdges = [
      { from: 's2', to: 's3' },
      { from: 's1', to: 's2' },
    ]

    relink(page, ['t1', 't2'], newId, DEFAULT_TEXT_STYLE)

    expect(m.readingEdges).toEqual([
      { from: 's2', to: 's3' },
      { from: 's1', to: 's2' },
    ])
    expect(page.readingEdges).toEqual([{ from: 'u1', to: 'u3' }])
  })
})

describe('Ctrl+Shift+L', () => {
  it('sends the selected blocks to a sentence of their own, read right after the one they left', () => {
    const m = manifestOf([src('s', 'ドキ'), tr('a', '撲'), tr('b', '通'), src('x', 'はぁ'), tr('y', '哈')], {
      [FACE]: [unit('u', ['s', 'a', 'b']), unit('v', ['x', 'y'])],
    })
    const page = facePage(m, FACE)
    expect(detach(page, ['b'], newId, DEFAULT_TEXT_STYLE)).toBe(true)
    expect(read(page)).toEqual(['ドキ | 撲', '□ | 通', 'はぁ | 哈'])
    expect(validatePage(m, [FACE])).toEqual([])
  })

  it("keeps a sentence's place when it loses the only word of the artwork it read by", () => {
    const m = manifestOf([src('s1', 'あ'), tr('t1', '一'), src('s2', 'い'), tr('t2', '二')], {
      [FACE]: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2'])],
    })
    m.readingOrder = ['s1', 's2']
    const page = facePage(m, FACE)
    expect(detach(page, ['s1'], newId, DEFAULT_TEXT_STYLE)).toBe(true)
    expect(read(page)).toEqual(['□ | 一', 'あ | □', 'い | 二'])
    expect(validatePage(m, [FACE])).toEqual([])
  })

  it('does nothing when the whole sentence is selected', () => {
    const page = facePage(gasps(), FACE)
    expect(detach(page, ['s1', 't1'], newId, DEFAULT_TEXT_STYLE)).toBe(false)
  })
})

/**
 * A source block belongs to every face at once, so regrouping one face's reading
 * may not take one away — the other ledgers are still naming it.
 */
describe('a page more than one face reads', () => {
  it("keeps a sentence this face emptied, because another face still reads its source block", () => {
    const m = gasps([FACE, OTHER])
    const page = facePage(m, FACE)

    relink(page, ['t4', 's3'], newId, DEFAULT_TEXT_STYLE, true)

    expect(read(page)).toEqual(['はぁ | 哈', 'はっ | 哈', 'れろ | 舔、嗯', '□ | □'])
    expect(textOnPage(m, 's4')).toBeDefined()
    expect(read(facePage(m, OTHER))).toEqual(['はぁ | ハ', 'はっ | ハ', 'れろ | ペロ', '□ | ん'])
    expect(validatePage(m, [FACE, OTHER])).toEqual([])
  })

  it('keeps a blank source block a join folded in, instead of tidying it away', () => {
    const m = gasps([FACE, OTHER])
    const page = facePage(m, FACE)

    relink(page, ['t3', 't4'], newId, DEFAULT_TEXT_STYLE, true)

    expect(read(page)).toEqual(['はぁ | 哈', 'はっ | 哈', 'れろ、□ | 舔、嗯'])
    expect(validatePage(m, [FACE, OTHER])).toEqual([])
  })

  it('tidies that same blank source away when no other face is reading it', () => {
    const m = gasps()
    const page = facePage(m, FACE)

    relink(page, ['t3', 't4'], newId, DEFAULT_TEXT_STYLE)

    expect(read(page)).toEqual(['はぁ | 哈', 'はっ | 哈', 'れろ | 舔、嗯'])
    expect(textOnPage(m, 's4')).toBeUndefined()
  })
})

describe('adoptSources', () => {
  it('gives a face that has read nothing a sentence for every source block, each with its own lettering', () => {
    const m = gasps()
    const s1 = textOnPage(m, 's1') as SourceTextLayerEntry
    s1.body.x = 40
    s1.body.y = 50

    adoptSources(m, [FACE, OTHER], newId, DEFAULT_TEXT_STYLE)

    const page = facePage(m, OTHER)
    expect(read(page)).toEqual(['はぁ | □', 'はっ | □', 'れろ | □', '□ | □'])
    const lettering = page.units.flatMap((u) => translationBlocksOf(page, u))
    expect(lettering.map((b) => b.face)).toEqual([OTHER, OTHER, OTHER, OTHER])
    // Standing on the block it letters rather than at the origin.
    expect([lettering[0]!.body.x, lettering[0]!.body.y]).toEqual([40, 50])
    expect(read(facePage(m, FACE))).toEqual(['はぁ | 哈', 'はっ | 哈', 'れろ | 舔', '□ | 嗯'])
    expect(validatePage(m, [FACE, OTHER])).toEqual([])
  })

  /** The blank source a regroup in one face had to create is a block every other face now has to place. */
  it('places a source block a regroup in another face created, reading it where the page reads it', () => {
    const m = gasps([FACE, OTHER])
    const page = facePage(m, FACE)
    detach(page, ['t3'], newId, DEFAULT_TEXT_STYLE, true)
    expect(validatePage(m, [FACE, OTHER])).toContainEqual(
      expect.objectContaining({ kind: 'unit-member-orphan', face: OTHER }),
    )

    adoptSources(m, [FACE, OTHER], newId, DEFAULT_TEXT_STYLE)

    const other = facePage(m, OTHER)
    expect(read(other)).toEqual(['はぁ | ハ', 'はっ | ハ', 'れろ | ペロ', '□ | □', '□ | ん'])
    expect(validatePage(m, [FACE, OTHER])).toEqual([])
  })

  it('leaves a face that already reads every source block alone', () => {
    const m = gasps([FACE, OTHER])
    adoptSources(m, [FACE, OTHER], newId, DEFAULT_TEXT_STYLE)
    const before = m.ledgers[OTHER]!.units.length
    const entries = everyEntry(m).length

    adoptSources(m, [FACE, OTHER], newId, DEFAULT_TEXT_STYLE)

    expect(m.ledgers[OTHER]!.units.length).toBe(before)
    expect(everyEntry(m).length).toBe(entries)
  })
})
