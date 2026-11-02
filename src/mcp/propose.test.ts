import { describe, expect, it } from 'vitest'
import type { TranslationBody, TranslationTextLayerEntry } from '@shared/page/types'
import { blankTranslationBlock } from '@shared/page/schema'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { planProposal } from './propose'

/** One block of lettering: what a proposal is written into. */
function block(lines: string[] = [], over: Partial<TranslationBody> = {}): TranslationTextLayerEntry {
  const entry = blankTranslationBlock('t', 'zh', DEFAULT_TEXT_STYLE)
  entry.body = { ...entry.body, lines, ...over }
  return entry
}

describe('planProposal', () => {
  it('refuses a proposal with nothing in it', () => {
    expect(planProposal(block(), { lines: [] })).toMatchObject({ action: 'refuse' })
    expect(planProposal(block(), { lines: ['', '  '] })).toMatchObject({ action: 'refuse' })
  })

  it('refuses a line that is really two lines', () => {
    expect(planProposal(block(), { lines: ['あ\nい'] })).toMatchObject({ action: 'refuse' })
  })

  it('fills the slot of a block that reads as nothing', () => {
    expect(planProposal(block(), { lines: ['訳'] })).toEqual({
      action: 'append',
      lines: ['訳'],
      fillSlot: true,
    })
  })

  /**
   * ⚠️ Blank is not the same as holding no characters. Somebody who left a
   * block standing on a few empty lines left it reading as nothing, and the
   * newlines between them are not writing.
   */
  it('fills the slot of a block left standing on empty lines', () => {
    expect(planProposal(block(['', '', '']), { lines: ['訳'] })).toMatchObject({ fillSlot: true })
  })

  it('leaves the slot alone where somebody typed something', () => {
    expect(planProposal(block(['書いた']), { lines: ['訳'] })).toMatchObject({ fillSlot: false })
  })

  it('leaves the slot alone where a candidate is already chosen', () => {
    const chosen = block([], { candidates: [{ id: 'c1', lines: ['えらんだ'] }], chosen: 'c1' })
    expect(planProposal(chosen, { lines: ['訳'] })).toMatchObject({ fillSlot: false })
  })

  /** A slot naming a candidate that has gone reads as the block's own words. */
  it('leaves the slot alone where it names a candidate the pool no longer holds', () => {
    expect(planProposal(block(['書いた'], { chosen: 'gone' }), { lines: ['訳'] })).toMatchObject({
      fillSlot: false,
    })
  })

  it('fills over typed words and a settled choice when asked to choose', () => {
    const settled = block(['書いた'], { candidates: [{ id: 't1', lines: ['舊'] }], chosen: 't1' })
    expect(planProposal(settled, { lines: ['新'], choose: true })).toEqual({
      action: 'append',
      lines: ['新'],
      fillSlot: true,
    })
  })
})
