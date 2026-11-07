import { describe, expect, it } from 'vitest'
import type { LayerEntry, ManifestJson, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { emptyCounters } from './numbers'
import { blankSourceBlock, blankTranslationBlock, treesFromOneTree } from './schema'
import { copyFace } from './faces'
import { facePage } from './units'
import { findTextObject } from './tree'

const FROM = 'f'
const TO = 'g'

function page(layers: LayerEntry[], units: TranslationUnit[]): ManifestJson {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name: 'p',
    width: 1200,
    height: 1700,
    ledgers: { [FROM]: { units } },
    readingOrder: [],
    readingEdges: [],
    counters: emptyCounters(),
    ...treesFromOneTree(layers, [FROM], FROM),
  }
}

describe('copyFace', () => {
  /**
   * ⭐ Where a sentence breaks across blocks is a decision about one language's
   * lines against the artwork, so a new face starts every sentence as a single
   * block standing where the first one does.
   */
  it('carries every sentence over as one empty block where its first block stands', () => {
    const first = blankTranslationBlock('t1', FROM, DEFAULT_TEXT_STYLE)
    first.body.x = 300
    first.body.y = 400
    first.body.lines = ['前半']
    const second = blankTranslationBlock('t2', FROM, DEFAULT_TEXT_STYLE)
    second.body.lines = ['後半']
    const m = page(
      [blankSourceBlock('s1', DEFAULT_TEXT_STYLE), first, second],
      [{ id: 'u1', members: ['s1', 't1', 't2'] }],
    )
    let next = 0
    copyFace(m, FROM, TO, () => `n${(next += 1)}`)

    const copied = facePage(m, TO).units
    expect(copied).toHaveLength(1)
    const [source, ...lettering] = copied[0].members
    expect(source).toBe('s1')
    expect(lettering).toHaveLength(1)
    const block = findTextObject(facePage(m, TO).layers, lettering[0])!
    expect([block.body.x, block.body.y, block.body.lines]).toEqual([300, 400, []])
    expect(facePage(m, FROM).units[0].members).toEqual(['s1', 't1', 't2'])
  })
})
