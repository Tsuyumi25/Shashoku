import { describe, expect, it } from 'vitest'
import type { LayerEntry, ManifestJson, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { emptyCounters } from './numbers'
import { blankSourceBlock, blankTranslationBlock, treesFromOneTree } from './schema'
import {
  projectedEdges,
  projectedOrder,
  readAfter,
  sourceEdgeFor,
  sourceEdgesUnder,
  sourceOrder,
  sourceOrderFor,
} from './reading'

const FACE = 'f'
const OTHER = 'g'

function unit(id: string, members: string[]): TranslationUnit {
  return { id, members }
}

/**
 * A page of blocks of the artwork named `s1`… and, per face, the lettering
 * `t1`… over them. Only what the reading is about is here: who holds which
 * block, and what the page says about the order.
 */
function pageOf(
  sources: string[],
  ledgers: Record<string, TranslationUnit[]>,
  readingOrder: string[] = [],
  readingEdges: { from: string; to: string }[] = [],
): ManifestJson {
  const layers: LayerEntry[] = sources.map((id) => blankSourceBlock(id, DEFAULT_TEXT_STYLE))
  for (const [face, units] of Object.entries(ledgers))
    for (const u of units)
      for (const id of u.members)
        if (!sources.includes(id)) layers.push(blankTranslationBlock(id, face, DEFAULT_TEXT_STYLE))
  const faces = Object.keys(ledgers)
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    ledgers: Object.fromEntries(Object.entries(ledgers).map(([face, units]) => [face, { units }])),
    readingOrder,
    readingEdges,
    counters: emptyCounters(),
    ...treesFromOneTree(layers, faces, faces[0] ?? FACE),
  }
}

describe('sourceOrder', () => {
  it('reads what the page names first and what it does not in the order the tree holds them', () => {
    const m = pageOf(['s1', 's2', 's3'], {}, ['s3'])
    expect(sourceOrder(m)).toEqual(['s3', 's1', 's2'])
  })

  it('passes over a name that is no block of the artwork on the page', () => {
    const m = pageOf(['s1'], {}, ['ghost', 's1'])
    expect(sourceOrder(m)).toEqual(['s1'])
  })
})

describe('projectedOrder', () => {
  it('puts each sentence where the earliest of its words reads', () => {
    const m = pageOf(
      ['s1', 's2', 's3'],
      { [FACE]: [unit('u1', ['s2', 't1']), unit('u2', ['s3', 's1', 't2'])] },
      ['s1', 's2', 's3'],
    )
    expect(projectedOrder(m, m.ledgers[FACE].units)).toEqual(['u2', 'u1'])
  })

  /** ⭐ Which is how a face that groups the artwork its own way reads the same page. */
  it('reads two faces over one order, each through its own sentences', () => {
    const m = pageOf(
      ['s1', 's2', 's3'],
      {
        [FACE]: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2']), unit('u3', ['s3', 't3'])],
        [OTHER]: [unit('v1', ['s2', 's3', 'g1']), unit('v2', ['s1', 'g2'])],
      },
      ['s3', 's1', 's2'],
    )
    expect(projectedOrder(m, m.ledgers[FACE].units)).toEqual(['u3', 'u1', 'u2'])
    expect(projectedOrder(m, m.ledgers[OTHER].units)).toEqual(['v1', 'v2'])
  })

  it('reads a sentence holding no block of the artwork last', () => {
    const m = pageOf(['s1'], { [FACE]: [unit('u1', ['t1']), unit('u2', ['s1', 't2'])] }, ['s1'])
    expect(projectedOrder(m, m.ledgers[FACE].units)).toEqual(['u2', 'u1'])
  })
})

describe('projectedEdges', () => {
  it('reads a line between two blocks as one between the sentences holding them', () => {
    const m = pageOf(
      ['s1', 's2'],
      { [FACE]: [unit('u1', ['s1', 't1']), unit('u2', ['s2', 't2'])] },
      ['s1', 's2'],
      [{ from: 's1', to: 's2' }],
    )
    expect(projectedEdges(m, m.ledgers[FACE].units)).toEqual([{ from: 'u1', to: 'u2' }])
  })

  /** ⭐ A sentence is not read before itself: inside one, the line says nothing here. */
  it('says nothing of a line between two blocks of one sentence', () => {
    const m = pageOf(
      ['s1', 's2'],
      { [FACE]: [unit('u1', ['s1', 's2', 't1'])] },
      ['s1', 's2'],
      [{ from: 's1', to: 's2' }],
    )
    expect(projectedEdges(m, m.ledgers[FACE].units)).toEqual([])
  })

  /**
   * ⚠️ A face that groups words the artwork reads apart can see a ring where
   * there is none. The line it cannot show is left out of the projection and
   * the fact underneath is untouched.
   */
  it('leaves out the line that would close a ring, keeping the fact', () => {
    const edges = [
      { from: 's1', to: 's2' },
      { from: 's2', to: 's3' },
    ]
    const m = pageOf(
      ['s1', 's2', 's3'],
      { [FACE]: [unit('u1', ['s1', 's3', 't1']), unit('u2', ['s2', 't2'])] },
      ['s1', 's2', 's3'],
      edges,
    )
    expect(projectedEdges(m, m.ledgers[FACE].units)).toEqual([{ from: 'u1', to: 'u2' }])
    expect(m.readingEdges).toEqual(edges)
  })

  it('keeps one line where two of the artwork say the same thing here', () => {
    const m = pageOf(
      ['s1', 's2', 's3', 's4'],
      { [FACE]: [unit('u1', ['s1', 's2', 't1']), unit('u2', ['s3', 's4', 't2'])] },
      ['s1', 's2', 's3', 's4'],
      [
        { from: 's1', to: 's3' },
        { from: 's2', to: 's4' },
      ],
    )
    expect(projectedEdges(m, m.ledgers[FACE].units)).toEqual([{ from: 'u1', to: 'u2' }])
  })
})

describe('sourceEdgeFor', () => {
  const m = () =>
    pageOf(
      ['s1', 's2', 's3'],
      {
        [FACE]: [unit('u1', ['s1', 's2', 't1']), unit('u2', ['s3', 't2'])],
        [OTHER]: [unit('v1', ['s1', 'g1']), unit('v2', ['s2', 's3', 'g2'])],
      },
      ['s1', 's2', 's3'],
    )

  /** ⭐ Drawn between sentences, written between words, read back as the line drawn. */
  it('writes the last word of one sentence before the first of the next, and projects back', () => {
    const page = m()
    const edge = sourceEdgeFor(page, page.ledgers[FACE].units, { from: 'u1', to: 'u2' })
    expect(edge).toEqual({ from: 's2', to: 's3' })
    page.readingEdges = [edge!]
    expect(projectedEdges(page, page.ledgers[FACE].units)).toEqual([{ from: 'u1', to: 'u2' }])
  })

  /** ⭐ And the other face sees the line between the sentences holding those words. */
  it('shows in a face that groups the same words differently', () => {
    const page = m()
    page.readingEdges = [sourceEdgeFor(page, page.ledgers[FACE].units, { from: 'u1', to: 'u2' })!]
    expect(projectedEdges(page, page.ledgers[OTHER].units)).toEqual([])

    page.readingEdges = [sourceEdgeFor(page, page.ledgers[FACE].units, { from: 'u2', to: 'u1' })!]
    expect(projectedEdges(page, page.ledgers[OTHER].units)).toEqual([{ from: 'v2', to: 'v1' }])
  })

  it('has nothing to write for a sentence holding no block of the artwork', () => {
    const page = pageOf(['s1'], { [FACE]: [unit('u1', ['s1', 't1']), unit('u2', ['t2'])] }, ['s1'])
    expect(sourceEdgeFor(page, page.ledgers[FACE].units, { from: 'u1', to: 'u2' })).toBeNull()
  })

  it('has nothing to write for an end no sentence answers to', () => {
    const page = m()
    expect(sourceEdgeFor(page, page.ledgers[FACE].units, { from: 'u1', to: 'ghost' })).toBeNull()
  })
})

describe('sourceEdgesUnder', () => {
  /** Rubbing a line out takes away everything the artwork says under it. */
  it('answers with every line of the artwork one between sentences stands for', () => {
    const m = pageOf(
      ['s1', 's2', 's3', 's4'],
      { [FACE]: [unit('u1', ['s1', 's2', 't1']), unit('u2', ['s3', 's4', 't2'])] },
      ['s1', 's2', 's3', 's4'],
      [
        { from: 's1', to: 's3' },
        { from: 's2', to: 's4' },
        { from: 's3', to: 's1' },
      ],
    )
    expect(sourceEdgesUnder(m, m.ledgers[FACE].units, { from: 'u1', to: 'u2' })).toEqual([
      { from: 's1', to: 's3' },
      { from: 's2', to: 's4' },
    ])
  })
})

describe('sourceOrderFor', () => {
  /** ⭐ A sentence is read as one stretch, so its words travel together. */
  it('keeps each sentence\u2019s words together, in the order they already had', () => {
    const m = pageOf(
      ['s1', 's2', 's3', 's4'],
      { [FACE]: [unit('u1', ['s1', 's3', 't1']), unit('u2', ['s2', 't2']), unit('u3', ['s4', 't3'])] },
      ['s1', 's2', 's3', 's4'],
    )
    expect(sourceOrderFor(m, m.ledgers[FACE].units, ['u3', 'u1', 'u2'])).toEqual([
      's4',
      's1',
      's3',
      's2',
    ])
  })

  it('leaves words no sentence of this face holds at the end', () => {
    const m = pageOf(['s1', 's2'], { [FACE]: [unit('u1', ['s2', 't1'])] }, ['s1', 's2'])
    expect(sourceOrderFor(m, m.ledgers[FACE].units, ['u1'])).toEqual(['s2', 's1'])
  })
})

describe('readAfter', () => {
  it('moves the named words to read straight after the last of the others', () => {
    const m = pageOf(['s1', 's2', 's3', 's4'], {}, ['s1', 's2', 's3', 's4'])
    readAfter(m, ['s4'], ['s1'])
    expect(m.readingOrder).toEqual(['s1', 's4', 's2', 's3'])
  })

  it('keeps the moved words in the order they already had', () => {
    const m = pageOf(['s1', 's2', 's3', 's4'], {}, ['s1', 's2', 's3', 's4'])
    readAfter(m, ['s4', 's2'], ['s1'])
    expect(m.readingOrder).toEqual(['s1', 's2', 's4', 's3'])
  })

  it('passes over anything that is no block of the artwork', () => {
    const m = pageOf(['s1', 's2'], {}, ['s1', 's2'])
    readAfter(m, ['t1'], ['s1'])
    expect(m.readingOrder).toEqual(['s1', 's2'])
  })

  it('reads them last when nothing they are to follow is left', () => {
    const m = pageOf(['s1', 's2', 's3'], {}, ['s1', 's2', 's3'])
    readAfter(m, ['s1'], ['s1'])
    expect(m.readingOrder).toEqual(['s2', 's3', 's1'])
  })

  /** The page's own order is settled by the move, naming every word it holds. */
  it('writes down an order the page had only implied', () => {
    const m = pageOf(['s1', 's2', 's3'], {})
    readAfter(m, ['s3'], ['s1'])
    expect(m.readingOrder).toEqual(['s1', 's3', 's2'])
  })
})
