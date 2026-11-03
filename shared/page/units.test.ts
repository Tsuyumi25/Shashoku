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
import { blankSourceBlock, blankTranslationBlock } from './schema'
import {
  blocksOnSide,
  chosenCandidateOf,
  facePage,
  isSingleton,
  isUntranslated,
  placeOfBlock,
  projectionCodeOf,
  projectionOf,
  shownCodeOf,
  shownLinesOf,
  tagsOfBlock,
  tagsOfUnit,
  unitsInReadingOrder,
  type FacePage,
} from './units'

const FACE = 'f'
const OTHER = 'g'

function src(id: string, lines: string[], tags: string[] = []): SourceTextLayerEntry {
  const entry = blankSourceBlock(id, DEFAULT_TEXT_STYLE)
  entry.body.lines = lines
  entry.body.tags = tags
  return entry
}

function tr(id: string, lines: string[], face = FACE): TranslationTextLayerEntry {
  const entry = blankTranslationBlock(id, face, DEFAULT_TEXT_STYLE)
  entry.body.lines = lines
  return entry
}

function unit(id: string, members: string[]): TranslationUnit {
  return { id, members }
}

function manifestOf(layers: LayerEntry[], units: TranslationUnit[], face = FACE): ManifestJson {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    ledgers: { [face]: { units } },
    readingOrder: [],
    readingEdges: [],
    counters: emptyCounters(),
    layers,
  }
}

function pageOf(layers: LayerEntry[], units: TranslationUnit[], face = FACE): FacePage {
  return facePage(manifestOf(layers, units, face), face)
}

const SOUND = [src('s', ['ゴゴゴ']), tr('t1', ['轟']), tr('t2', ['隆'])]
const SPLIT = unit('u1', ['s', 't1', 't2'])

describe('facePage', () => {
  it('reads and writes the ledger of its own face', () => {
    const manifest = manifestOf(SOUND, [SPLIT])
    const page = facePage(manifest, FACE)

    page.units = [unit('u2', ['s', 't1'])]

    expect(manifest.ledgers[FACE]?.units.map((u) => u.id)).toEqual(['u2'])
    expect(page.units).toBe(manifest.ledgers[FACE]?.units)
  })

  /** A face added to a project has read nothing of a page it has never been on. */
  it('reads a face with no ledger as a page with no sentences', () => {
    const manifest = manifestOf(SOUND, [SPLIT])
    const page = facePage(manifest, OTHER)

    expect(page.units).toEqual([])
    expect(page.readingOrder).toEqual([])

    page.units.push(unit('u9', ['s']))

    expect(manifest.ledgers[OTHER]?.units.map((u) => u.id)).toEqual(['u9'])
  })
})

describe('projectionOf', () => {
  it('reads one block as the words in it', () => {
    const page = pageOf([src('s', ['ゴゴゴ']), tr('t', ['轟隆'])], [unit('u1', ['s', 't'])])
    expect(projectionOf(page, unit('u1', ['s', 't']), 'translation')).toBe('轟隆')
  })

  it('reads several blocks as one stretch, in the order the sentence holds them', () => {
    expect(projectionOf(pageOf(SOUND, [SPLIT]), SPLIT, 'translation')).toBe('轟/隆')
  })

  /** The whole point: one sound stays one entry in the ledger. */
  it('leaves the source alone when the lettering is split', () => {
    expect(projectionOf(pageOf(SOUND, [SPLIT]), SPLIT, 'source')).toBe('ゴゴゴ')
  })

  it('skips a member the page no longer holds rather than reading a gap', () => {
    const lost = unit('u1', ['s', 't1', 'gone'])
    expect(projectionOf(pageOf(SOUND, [lost]), lost, 'translation')).toBe('轟')
  })

  /** Every face reads the same artwork, so a sentence may name another face's lettering. */
  it("skips another face's lettering", () => {
    const layers = [...SOUND, tr('o', ['どーん'], OTHER)]
    const shared = unit('u1', ['s', 't1', 't2', 'o'])
    expect(projectionOf(pageOf(layers, [shared]), shared, 'translation')).toBe('轟/隆')
  })
})

describe('what a block reads as', () => {
  it('reads the words typed into it when nothing is chosen', () => {
    expect(shownLinesOf(tr('t', ['自己打的']))).toEqual(['自己打的'])
  })

  it('reads the chosen candidate instead of them', () => {
    const block = tr('t', ['自己打的'])
    block.body.candidates = [{ id: 'c1', lines: ['提的'] }]
    block.body.chosen = 'c1'
    expect(shownLinesOf(block)).toEqual(['提的'])
    expect(chosenCandidateOf(block)?.id).toBe('c1')
  })

  /** The block still holds the person's words, so a pointer come loose costs nothing. */
  it('falls back to its own words when the slot names a candidate the pool lost', () => {
    const block = tr('t', ['留著'])
    block.body.chosen = 'gone'
    expect(chosenCandidateOf(block)).toBeNull()
    expect(shownLinesOf(block)).toEqual(['留著'])
  })

  /** Nobody proposes readings of the artwork, so the source says its own words. */
  it('leaves a source block reading its own words', () => {
    expect(shownLinesOf(src('s', ['ゴゴゴ']))).toEqual(['ゴゴゴ'])
  })
})

describe('the markup and the words in it', () => {
  const MARKED = [src('s', ['&lt;ゴゴゴ&gt;']), tr('t1', ['<size=×2>轟']), tr('t2', ['隆</size>'])]

  it('reads a block as its words and keeps its markup apart', () => {
    expect(shownCodeOf(MARKED[1])).toBe('<size=×2>轟')
    expect(shownLinesOf(MARKED[1])).toEqual(['轟'])
    expect(shownLinesOf(MARKED[0])).toEqual(['<ゴゴゴ&gt;'])
  })

  /** A tag may swallow the line break it spans, which is why the code is read whole. */
  it('reads a block whose tag spans a line break as one line fewer', () => {
    expect(shownLinesOf(src('s', ['頭<size=×2', 'px>尾']))).toEqual(['頭尾'])
  })

  it('reads a side as its words and offers the markup to whoever wants it', () => {
    const page = pageOf(MARKED, [SPLIT])
    expect(projectionOf(page, SPLIT, 'translation')).toBe('轟/隆')
    expect(projectionCodeOf(page, SPLIT, 'translation')).toBe('<size=×2>轟/隆</size>')
  })

  it('calls a translation holding nothing but a tag untranslated', () => {
    const blank = unit('u1', ['s', 't'])
    const page = pageOf([src('s', ['ゴ']), tr('t', ['<size=×2></size>'])], [blank])
    expect(isUntranslated(page, blank)).toBe(true)
  })
})

describe('isUntranslated', () => {
  it('is true where every block of this face is empty', () => {
    const blank = unit('u1', ['s', 't'])
    expect(isUntranslated(pageOf([src('s', ['ゴゴゴ']), tr('t', [''])], [blank]), blank)).toBe(true)
  })

  /** What MCP leaves behind when it fills a blank block's slot. */
  it('is false when only the chosen candidate has words', () => {
    const block = tr('t', [''])
    block.body.candidates = [{ id: 'c1', lines: ['轟隆'] }]
    block.body.chosen = 'c1'
    const picked = unit('u1', ['s', 't'])
    expect(isUntranslated(pageOf([src('s', ['ゴゴゴ']), block], [picked]), picked)).toBe(false)
  })

  /** One face being done says nothing about another's. */
  it("is true although another face's lettering in the sentence has words", () => {
    const blank = unit('u1', ['s', 't', 'o'])
    const layers = [src('s', ['ゴゴゴ']), tr('t', ['']), tr('o', ['轟隆'], OTHER)]
    expect(isUntranslated(pageOf(layers, [blank]), blank)).toBe(true)
  })
})

describe('isSingleton', () => {
  it('is true for one block a side, which is what an ordinary balloon is', () => {
    const one = unit('u1', ['s', 't'])
    expect(isSingleton(pageOf([src('s', ['ゴ']), tr('t', ['轟'])], [one]), one)).toBe(true)
  })

  it('is false once a side is split', () => {
    expect(isSingleton(pageOf(SOUND, [SPLIT]), SPLIT)).toBe(false)
  })
})

describe('placeOfBlock', () => {
  it('says which sentence a block belongs to, and which side it is', () => {
    const page = pageOf(SOUND, [SPLIT])
    expect(placeOfBlock(page, 't2')).toMatchObject({ side: 'translation', unit: { id: 'u1' } })
    expect(placeOfBlock(page, 's')).toMatchObject({ side: 'source', unit: { id: 'u1' } })
  })

  it('answers nothing for a block no sentence claims', () => {
    expect(placeOfBlock(pageOf(SOUND, [SPLIT]), 'stray')).toBeUndefined()
  })

  /** The sentence is this face's; another face's lettering is not in it to find. */
  it("answers nothing for another face's lettering", () => {
    const layers = [...SOUND, tr('o', ['どーん'], OTHER)]
    const page = pageOf(layers, [unit('u1', ['s', 't1', 't2', 'o'])])
    expect(placeOfBlock(page, 'o')).toBeUndefined()
  })
})

describe('blocksOnSide', () => {
  it("takes one side's blocks, and of the translation only the face asked for", () => {
    const layers = [...SOUND, tr('o', ['どーん'], OTHER)]
    expect(blocksOnSide(layers, 'translation', FACE).map((b) => b.id)).toEqual(['t1', 't2'])
    expect(blocksOnSide(layers, 'translation', OTHER).map((b) => b.id)).toEqual(['o'])
    expect(blocksOnSide(layers, 'source', OTHER).map((b) => b.id)).toEqual(['s'])
  })
})

describe('tagsOfUnit', () => {
  it('is what every block of the artwork in the sentence means, together', () => {
    const layers = [src('s1', ['ゴ'], ['叫']), src('s2', ['ゴ'], ['心聲', '叫']), tr('t', ['轟'])]
    const joined = unit('u1', ['s1', 's2', 't'])
    expect(tagsOfUnit(pageOf(layers, [joined]), joined)).toEqual(['叫', '心聲'])
  })

  it('reaches a block of lettering through the sentence it is in', () => {
    const layers = [src('s', ['ゴ'], ['叫']), tr('t', ['轟'])]
    const page = pageOf(layers, [unit('u1', ['s', 't'])])
    expect(tagsOfBlock(page, 't')).toEqual(['叫'])
  })

  it('has nothing to say about a block in no sentence', () => {
    expect(tagsOfBlock(pageOf(SOUND, [SPLIT]), 'stray')).toEqual([])
  })
})

describe('unitsInReadingOrder', () => {
  const TWO = [src('s1', ['ゴ']), tr('t1', ['轟']), src('s2', ['ゴゴ']), tr('t2', ['隆'])]

  it("follows the page's reading of the artwork, not the tree", () => {
    const manifest = manifestOf(TWO, [unit('a', ['s1', 't1']), unit('b', ['s2', 't2'])])
    manifest.readingOrder = ['s2', 's1']
    expect(unitsInReadingOrder(facePage(manifest, FACE)).map((u) => u.id)).toEqual(['b', 'a'])
  })

  it('reads a sentence holding no block of the artwork last', () => {
    const page = pageOf(TWO, [unit('a', ['t1']), unit('b', ['s1', 's2', 't2'])])
    expect(unitsInReadingOrder(page).map((u) => u.id)).toEqual(['b', 'a'])
  })
})
