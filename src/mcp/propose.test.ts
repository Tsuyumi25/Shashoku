import { describe, expect, it } from 'vitest'
import type { ManifestJson, TranslationUnit } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION } from '@shared/page/types'
import { blankBlock } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { planProposal } from './propose'

/** One translation set in `blocks` blocks, with the page that holds them. */
function said(
  over: Partial<TranslationUnit> = {},
  words: string[][] = [[]],
): { page: ManifestJson; unit: TranslationUnit } {
  const blocks = words.map((lines, at) => {
    const block = blankBlock(`o${at + 1}`, 'translation', DEFAULT_TEXT_STYLE)
    block.body.lines = lines
    return block
  })
  const source = blankBlock('s1', 'source', DEFAULT_TEXT_STYLE)
  const unit: TranslationUnit = {
    id: 'u1',
    tags: [],
    source: { members: ['s1'], separators: [] },
    translation: { members: blocks.map((b) => b.id), separators: blocks.slice(1).map(() => '') },
    candidates: [],
    chosen: null,
    ...over,
  }
  return {
    page: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      translationUnits: [unit],
      readingOrder: [unit.id],
      readingEdges: [],
      layers: [...blocks, source],
    },
    unit,
  }
}

const plan = (
  it: { page: ManifestJson; unit: TranslationUnit },
  lines: string[],
) => planProposal(it.page, it.unit, { unitId: it.unit.id, lines })

describe('planProposal', () => {
  it('refuses a translation that is not there', () => {
    const one = said()
    expect(
      planProposal(one.page, undefined, { unitId: 'gone', lines: ['あ'] }),
    ).toMatchObject({ action: 'refuse' })
  })

  it('refuses a proposal with nothing in it', () => {
    expect(plan(said(), [])).toMatchObject({ action: 'refuse' })
    expect(plan(said(), ['', '  '])).toMatchObject({ action: 'refuse' })
  })

  it('refuses a line that is really two lines', () => {
    expect(plan(said(), ['あ\nい'])).toMatchObject({ action: 'refuse' })
  })

  /** ⚠️ Two ways of saying the same thing, and no rule picks between them. */
  it('refuses a caller that sends both lines and pieces', () => {
    const one = said()
    expect(
      planProposal(one.page, one.unit, {
        unitId: one.unit.id,
        lines: ['あ'],
        pieces: [['あ']],
      }),
    ).toMatchObject({ action: 'refuse' })
  })

  it('fills the slot of a translation that reads as nothing', () => {
    expect(plan(said(), ['訳'])).toEqual({ action: 'append', pieces: [['訳']], fillSlot: true })
  })

  /**
   * ⚠️ Blank is not the same as holding no characters. Somebody who left a
   * block standing on a few empty lines left it reading as nothing, and the
   * newlines between them are not writing.
   */
  it('fills the slot of a translation left standing on empty lines', () => {
    expect(plan(said({}, [['', '', '']]), ['訳'])).toMatchObject({ fillSlot: true })
  })

  it('leaves the slot alone where somebody typed something', () => {
    expect(plan(said({}, [['書いた']]), ['訳'])).toMatchObject({ fillSlot: false })
  })

  it('leaves the slot alone where a candidate is already chosen', () => {
    const chosen = said({ candidates: [{ id: 'c1', pieces: [['えらんだ']] }], chosen: 'c1' })
    expect(plan(chosen, ['訳'])).toMatchObject({ fillSlot: false })
  })

  /** A slot naming a candidate that has gone reads as the block's own words. */
  it('leaves the slot alone where it names a candidate the pool no longer holds', () => {
    expect(plan(said({ chosen: 'gone' }, [['書いた']]), ['訳'])).toMatchObject({
      fillSlot: false,
    })
  })

  /**
   * ⭐ The one new refusal the split brings: a one-piece proposal has no block
   * to show its words from when the lettering is set in two.
   */
  it('takes a one-piece proposal for a two-block translation without filling', () => {
    expect(plan(said({}, [[], []]), ['訳'])).toMatchObject({
      action: 'append',
      fillSlot: false,
    })
  })

  it('fills where the proposal has a piece for every block', () => {
    const two = said({}, [[], []])
    expect(
      planProposal(two.page, two.unit, {
        unitId: two.unit.id,
        pieces: [['轟'], ['隆']],
      }),
    ).toEqual({ action: 'append', pieces: [['轟'], ['隆']], fillSlot: true })
  })
})
