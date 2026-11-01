import { describe, expect, it } from 'vitest'
import type { LayerEntry, ManifestJson, TranslationUnit } from './types'
import { MANIFEST_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { blankBlock } from './schema'
import { detach, planRelink, relink } from './relink'
import { shownCodeOf } from './units'
import { findTextObject } from './tree'
import { validatePage } from './validate'

function src(id: string, text: string): LayerEntry {
  const e = blankBlock(id, 'source', DEFAULT_TEXT_STYLE)
  e.body.lines = [text]
  return e
}
function tr(id: string, text: string): LayerEntry {
  const e = blankBlock(id, 'translation', DEFAULT_TEXT_STYLE)
  e.body.lines = [text]
  return e
}
function unit(id: string, source: string[], translation: string[], over: Partial<TranslationUnit> = {}): TranslationUnit {
  return {
    id,
    tags: [],
    source: { members: source, separators: source.slice(1).map(() => '') },
    translation: { members: translation, separators: translation.slice(1).map(() => '') },
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

let n = 0
const newId = () => `new${++n}`

/** Each sentence as "source | translation", in reading order. */
function read(p: ManifestJson): string[] {
  const words = (ids: string[]) =>
    ids.map((id) => shownCodeOf(p, findTextObject(p.layers, id)!) || '□').join('、')
  return p.readingOrder.map((uid) => {
    const u = p.translationUnits.find((x) => x.id === uid)!
    return `${words(u.source.members)} | ${words(u.translation.members)}`
  })
}

/** Three gasps, each its own sentence, and one sentence put down from a material with no source yet. */
function gasps(): ManifestJson {
  return page(
    [src('s1', 'はぁ'), tr('t1', '哈'), src('s2', 'はっ'), tr('t2', '哈'), src('s3', 'れろ'), tr('t3', '舔'), src('s4', ''), tr('t4', '嗯')],
    [unit('u1', ['s1'], ['t1']), unit('u2', ['s2'], ['t2']), unit('u3', ['s3'], ['t3']), unit('u4', ['s4'], ['t4'])],
  )
}

describe('Ctrl+L', () => {
  it('folds the sentences of blocks selected on one side into the first in reading order, both sides travelling', () => {
    const p = gasps()
    expect(relink(p, ['t2', 't1'], newId, DEFAULT_TEXT_STYLE)).toBe(true)
    expect(read(p)).toEqual(['はぁ、はっ | 哈、哈', 'れろ | 舔', '□ | 嗯'])
    expect(validatePage(p)).toEqual([])
  })

  it('pairs across sides by moving only what was selected, keeping what the sentence already had', () => {
    const p = gasps()
    relink(p, ['t4', 's3'], newId, DEFAULT_TEXT_STYLE)
    // The material's sentence had nothing else real, so it is gone.
    expect(read(p)).toEqual(['はぁ | 哈', 'はっ | 哈', 'れろ | 舔、嗯'])
    expect(validatePage(p)).toEqual([])
  })

  it('leaves a blank behind on the side a pairing emptied, so the sentence it left stays whole', () => {
    const p = gasps()
    relink(p, ['t2', 's1'], newId, DEFAULT_TEXT_STYLE)
    expect(read(p)).toEqual(['はぁ | 哈、哈', 'はっ | □', 'れろ | 舔', '□ | 嗯'])
    expect(validatePage(p)).toEqual([])
  })

  it('does nothing for blocks already in one sentence', () => {
    const p = gasps()
    expect(planRelink(p, ['s1', 't1'])).toEqual({ kind: 'none' })
    expect(relink(p, ['t1'], newId, DEFAULT_TEXT_STYLE)).toBe(false)
  })

  it('writes the chosen proposal into the blocks before the translation changes shape, losing no word', () => {
    const p = gasps()
    const u1 = p.translationUnits[0]!
    u1.candidates = [{ id: 'c', pieces: [['哈啊']] }]
    u1.chosen = 'c'
    relink(p, ['t2', 't1'], newId, DEFAULT_TEXT_STYLE)
    const main = p.translationUnits.find((u) => u.id === 'u1')!
    expect(main.chosen).toBeNull()
    expect(main.candidates.map((c) => c.id)).toEqual(['c'])
    expect(read(p)[0]).toBe('はぁ、はっ | 哈啊、哈')
  })

  it('carries the lines drawn to a folded sentence over to the one it joined', () => {
    const p = gasps()
    p.readingEdges = [{ from: 'u2', to: 'u3' }, { from: 'u1', to: 'u2' }]
    relink(p, ['t1', 't2'], newId, DEFAULT_TEXT_STYLE)
    expect(p.readingEdges).toEqual([{ from: 'u1', to: 'u3' }])
  })
})

describe('Ctrl+Shift+L', () => {
  it('sends the selected blocks to a sentence of their own, read right after the one they left', () => {
    const p = page(
      [src('s', 'ドキ'), tr('a', '撲'), tr('b', '通'), src('x', 'はぁ'), tr('y', '哈')],
      [unit('u', ['s'], ['a', 'b']), unit('v', ['x'], ['y'])],
    )
    expect(detach(p, ['b'], newId, DEFAULT_TEXT_STYLE)).toBe(true)
    expect(read(p)).toEqual(['ドキ | 撲', '□ | 通', 'はぁ | 哈'])
    expect(validatePage(p)).toEqual([])
  })

  it('does nothing when the whole sentence is selected', () => {
    const p = gasps()
    expect(detach(p, ['s1', 't1'], newId, DEFAULT_TEXT_STYLE)).toBe(false)
  })
})
