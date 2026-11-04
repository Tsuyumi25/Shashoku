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
import { emptyCounters, letterOf, noOfLetter, numberPage } from './numbers'
import { blankSourceBlock, blankTranslationBlock, serializeManifest, treesFromOneTree } from './schema'
import { addFaceEntry, addPageEntry, removeFromPage, resolveTrees, snapshotTrees, textOnPage } from './trees'

const FACE = 'f'
const OTHER = 'g'

function src(id: string): SourceTextLayerEntry {
  return blankSourceBlock(id, DEFAULT_TEXT_STYLE)
}

function tr(id: string, face = FACE): TranslationTextLayerEntry {
  return blankTranslationBlock(id, face, DEFAULT_TEXT_STYLE)
}

function unit(id: string, members: string[]): TranslationUnit {
  return { id, members }
}

function page(
  layers: LayerEntry[],
  ledgers: Record<string, { units: TranslationUnit[] }>,
  readingOrder: string[] = [],
): ManifestJson {
  const faces = Object.keys(ledgers)
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    ledgers: Object.fromEntries(Object.entries(ledgers).map(([face, { units }]) => [face, { units }])),
    readingOrder,
    readingEdges: [],
    counters: emptyCounters(),
    ...treesFromOneTree(layers, faces, faces[0]),
  }
}

const noOf = (m: ManifestJson, id: string): number | undefined => textOnPage(m, id)?.no

const unitNo = (m: ManifestJson, face: string, id: string): number | undefined =>
  m.ledgers[face].units.find((u) => u.id === id)?.no

const letteringOf = (m: ManifestJson, id: string): TranslationTextLayerEntry =>
  textOnPage(m, id) as TranslationTextLayerEntry

describe('numbering a page that has none', () => {
  it('numbers sentences in the order they are read, not the order they are stored', () => {
    const m = page(
      [src('s1'), tr('t1'), src('s2'), tr('t2'), src('s3'), tr('t3')],
      { [FACE]: { units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2']), unit('u3', ['s3', 't3'])] } },
      ['s2', 's3', 's1'],
    )

    numberPage(m, [FACE])

    expect([unitNo(m, FACE, 'u2'), unitNo(m, FACE, 'u3'), unitNo(m, FACE, 'u1')]).toEqual([1, 2, 3])
  })

  it('numbers a sentence the reading order does not name after the ones it does', () => {
    const m = page(
      [src('s1'), tr('t1'), src('s2'), tr('t2')],
      { [FACE]: { units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2'])] } },
      ['s2'],
    )

    numberPage(m, [FACE])

    expect([unitNo(m, FACE, 'u2'), unitNo(m, FACE, 'u1')]).toEqual([1, 2])
  })

  it("numbers the artwork's blocks for the page and the lettering for its sentence", () => {
    const m = page([src('s1'), tr('t1'), src('s2'), tr('t2'), tr('t3')], {
      [FACE]: { units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2', 't3'])] },
    })

    numberPage(m, [FACE])

    expect([noOf(m, 's1'), noOf(m, 's2')]).toEqual([1, 2])
    expect([noOf(m, 't1'), noOf(m, 't2'), noOf(m, 't3')]).toEqual([1, 1, 2])
  })

  it('writes down which sentence issued a block of lettering its number', () => {
    const m = page([src('s1'), tr('t1')], { [FACE]: { units: [unit('u1', ['s1', 't1'])] } })

    numberPage(m, [FACE])

    expect(letteringOf(m, 't1').numberedIn).toBe('u1')
  })

  it('leaves the page alone when it is run again', () => {
    const m = page([src('s1'), tr('t1'), src('s2'), tr('t2')], {
      [FACE]: { units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2'])] },
    })

    numberPage(m, [FACE])
    const once = serializeManifest(m)
    numberPage(m, [FACE])

    expect(serializeManifest(m)).toBe(once)
  })
})

describe('a number its holder has lost', () => {
  function twoSentences(): ManifestJson {
    const m = page([src('s1'), tr('t1'), src('s2'), tr('t2')], {
      [FACE]: { units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2'])] },
    })
    numberPage(m, [FACE])
    return m
  }

  it('is not handed to the next sentence made after it is deleted', () => {
    const m = twoSentences()

    m.ledgers[FACE].units = m.ledgers[FACE].units.filter((u) => u.id !== 'u2')
    removeFromPage(m, 's2')
    removeFromPage(m, 't2')
    numberPage(m, [FACE])
    addPageEntry(m, src('s3'))
    addFaceEntry(m, FACE, tr('t3'))
    m.ledgers[FACE].units.push(unit('u3', ['s3', 't3']))
    numberPage(m, [FACE])

    expect(unitNo(m, FACE, 'u3')).toBe(3)
    expect(noOf(m, 's3')).toBe(3)
  })

  /**
   * Undo writes back the ledgers and the tree it took a copy of, and the
   * counters sit outside both: the sentence that came back wears the number it
   * always wore, and the one the undone edit used is still spent.
   */
  it('is still spent after undo puts the sentence that wore it back', () => {
    const m = twoSentences()
    const ledgers = structuredClone(m.ledgers)
    const trees = snapshotTrees(m)

    m.ledgers[FACE].units = m.ledgers[FACE].units.filter((u) => u.id !== 'u2')
    removeFromPage(m, 's2')
    removeFromPage(m, 't2')
    addPageEntry(m, src('s3'))
    addFaceEntry(m, FACE, tr('t3'))
    m.ledgers[FACE].units.push(unit('u3', ['s3', 't3']))
    numberPage(m, [FACE])
    expect(unitNo(m, FACE, 'u3')).toBe(3)

    m.ledgers = ledgers
    m.pageTree = structuredClone(trees.pageTree)
    m.faceTrees = resolveTrees(m.pageTree, structuredClone(trees.faceTrees))
    numberPage(m, [FACE])
    expect(unitNo(m, FACE, 'u2')).toBe(2)

    addPageEntry(m, src('s4'))
    addFaceEntry(m, FACE, tr('t4'))
    m.ledgers[FACE].units.push(unit('u4', ['s4', 't4']))
    numberPage(m, [FACE])

    expect(unitNo(m, FACE, 'u4')).toBe(4)
    expect(noOf(m, 's4')).toBe(4)
  })
})

describe('a number two things wear at once', () => {
  it('is kept by the one that comes first and taken off the copy', () => {
    const m = page([src('s1'), tr('t1'), tr('t2')], {
      [FACE]: { units: [unit('u1', ['s1', 't1', 't2'])] },
    })
    numberPage(m, [FACE])
    const copy = tr('t3')
    copy.no = noOf(m, 't1')
    copy.numberedIn = 'u1'
    addFaceEntry(m, FACE, copy)
    m.ledgers[FACE].units[0].members.push('t3')

    numberPage(m, [FACE])

    expect([noOf(m, 't1'), noOf(m, 't2'), noOf(m, 't3')]).toEqual([1, 2, 3])
  })
})

describe('a block of lettering that changed sentence', () => {
  it('is numbered again by the sentence it landed in, and the rest are left alone', () => {
    const m = page([src('s1'), tr('t1'), tr('t2'), src('s2'), tr('t3')], {
      [FACE]: { units: [unit('u1', ['s1', 't1', 't2']), unit('u2', ['s2', 't3'])] },
    })
    numberPage(m, [FACE])
    expect([noOf(m, 't1'), noOf(m, 't2'), noOf(m, 't3')]).toEqual([1, 2, 1])

    m.ledgers[FACE].units[0].members = ['s1', 't1']
    m.ledgers[FACE].units[1].members = ['s2', 't3', 't2']
    numberPage(m, [FACE])

    expect(noOf(m, 't2')).toBe(2)
    expect(letteringOf(m, 't2').numberedIn).toBe('u2')
    expect([noOf(m, 't1'), noOf(m, 't3')]).toEqual([1, 1])
  })
})

describe('a sentence in a second face', () => {
  it("reads under the number the first face's sentence over the same artwork wears", () => {
    const m = page([src('s1'), src('s2'), tr('t1'), tr('t2'), tr('g1', OTHER), tr('g2', OTHER)], {
      [FACE]: { units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2'])] },
      [OTHER]: { units: [unit('v1', ['s2', 'g1']), unit('v2', ['s1', 'g2'])] },
    })

    numberPage(m, [FACE, OTHER])

    expect([unitNo(m, FACE, 'u1'), unitNo(m, FACE, 'u2')]).toEqual([1, 2])
    expect(unitNo(m, OTHER, 'v1')).toBe(2)
  })

  /**
   * `v1` is read first — it holds the block the page reads first — and takes
   * the number of the sentence over `s3`, which is its own first member. The
   * sentence after it can only count on.
   */
  it('falls back to its own count when that number is already behind it', () => {
    const m = page(
      [src('s1'), src('s2'), src('s3'), tr('t1'), tr('t2'), tr('t3'), tr('g1', OTHER), tr('g2', OTHER)],
      {
        [FACE]: {
          units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2']), unit('u3', ['s3', 't3'])],
        },
        [OTHER]: { units: [unit('v1', ['s3', 's1', 'g1']), unit('v2', ['s2', 'g2'])] },
      },
    )

    numberPage(m, [FACE, OTHER])

    expect(unitNo(m, OTHER, 'v1')).toBe(3)
    expect(unitNo(m, OTHER, 'v2')).toBe(4)
  })

  it('does not take a number a sentence of its own face already wears', () => {
    const m = page([src('s1'), src('s2'), tr('t1'), tr('t2'), tr('g1', OTHER), tr('g2', OTHER)], {
      [FACE]: { units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2'])] },
      [OTHER]: { units: [unit('v1', ['s1', 'g1']), unit('v2', ['s2', 'g2'])] },
    })
    m.ledgers[OTHER].units[1].no = 1

    numberPage(m, [FACE, OTHER])

    expect(unitNo(m, OTHER, 'v2')).toBe(1)
    expect(unitNo(m, OTHER, 'v1')).toBe(2)
  })

  it('counts on from its own counter rather than reusing a spent number', () => {
    const m = page([src('s1'), tr('t1'), tr('g1', OTHER)], {
      [FACE]: { units: [unit('u1', ['s1', 't1'])] },
      [OTHER]: { units: [unit('v1', ['s1', 'g1'])] },
    })
    m.counters.units[OTHER] = 5

    numberPage(m, [FACE, OTHER])

    expect(unitNo(m, FACE, 'u1')).toBe(1)
    expect(unitNo(m, OTHER, 'v1')).toBe(5)
  })
})

describe("the candidates in a block's drawer", () => {
  it('are counted by their own block, each drawer from one', () => {
    const m = page([src('s1'), tr('t1'), src('s2'), tr('t2')], {
      [FACE]: { units: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2'])] },
    })
    letteringOf(m, 't1').body.candidates = [
      { id: 'c1', lines: ['一'] },
      { id: 'c2', lines: ['二'] },
    ]
    letteringOf(m, 't2').body.candidates = [{ id: 'c3', lines: ['三'] }]

    numberPage(m, [FACE])

    expect(letteringOf(m, 't1').body.candidates.map((c) => c.no)).toEqual([1, 2])
    expect(letteringOf(m, 't2').body.candidates.map((c) => c.no)).toEqual([1])
  })

  it('never see a letter again once the candidate wearing it is withdrawn', () => {
    const m = page([src('s1'), tr('t1')], { [FACE]: { units: [unit('u1', ['s1', 't1'])] } })
    const block = letteringOf(m, 't1')
    block.body.candidates = [
      { id: 'c1', lines: ['一'] },
      { id: 'c2', lines: ['二'] },
    ]
    numberPage(m, [FACE])

    block.body.candidates = block.body.candidates.filter((c) => c.id !== 'c2')
    block.body.candidates.push({ id: 'c3', lines: ['三'] })
    numberPage(m, [FACE])

    expect(block.body.candidates.map((c) => c.no)).toEqual([1, 3])
  })
})

describe('a candidate letter', () => {
  it('counts a to z and then on into two letters', () => {
    expect(letterOf(1)).toBe('a')
    expect(letterOf(26)).toBe('z')
    expect(letterOf(27)).toBe('aa')
    expect(letterOf(52)).toBe('az')
    expect(letterOf(53)).toBe('ba')
  })

  it('reads back as the number it stands for', () => {
    for (const no of [1, 2, 25, 26, 27, 28, 52, 53, 702, 703]) {
      expect(noOfLetter(letterOf(no))).toBe(no)
    }
  })

  it('is nothing at all for anything that is not one', () => {
    expect(noOfLetter('')).toBeNull()
    expect(noOfLetter('A')).toBeNull()
    expect(noOfLetter('a1')).toBeNull()
    expect(noOfLetter('1')).toBeNull()
  })
})
