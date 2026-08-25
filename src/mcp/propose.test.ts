import { describe, expect, it } from 'vitest'
import type { TextLayerEntry } from '@shared/page/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { planProposal } from './propose'

const object = (over: Partial<TextLayerEntry> = {}): TextLayerEntry => ({
  kind: 'text',
  id: 'o1',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  effects: [],
  x: 0,
  y: 0,
  tags: [],
  rotation: 0,
  lines: [''],
  source: { hash: null, by: 'auto' },
  ownSource: '',
  translations: [],
  translation: null,
  style: { ...DEFAULT_TEXT_STYLE },
  ...over,
})

describe('planProposal', () => {
  it('refuses an object that is not there', () => {
    expect(planProposal(undefined, ['あ'])).toMatchObject({ action: 'refuse' })
  })

  it('refuses a proposal with nothing in it', () => {
    expect(planProposal(object(), [])).toMatchObject({ action: 'refuse' })
    expect(planProposal(object(), ['', '  '])).toMatchObject({ action: 'refuse' })
  })

  it('refuses a line that is really two lines', () => {
    expect(planProposal(object(), ['あ\nい'])).toMatchObject({ action: 'refuse' })
  })

  it('fills the slot of an object that reads as nothing', () => {
    expect(planProposal(object(), ['訳'])).toEqual({ action: 'append', fillSlot: true })
  })

  /**
   * ⚠️ Blank is not the same as holding no characters. Somebody who left an
   * object standing on a few empty lines left it reading as nothing, and the
   * newlines between them are not writing.
   */
  it('fills the slot of an object left standing on empty lines', () => {
    expect(planProposal(object({ lines: ['', '', ''] }), ['訳'])).toEqual({
      action: 'append',
      fillSlot: true,
    })
  })

  it('leaves the slot alone where somebody typed something', () => {
    expect(planProposal(object({ lines: ['書いた'] }), ['訳'])).toEqual({
      action: 'append',
      fillSlot: false,
    })
  })

  it('leaves the slot alone where a candidate is already chosen', () => {
    const chosen = object({
      translations: [{ id: 'c1', lines: ['えらんだ'] }],
      translation: 'c1',
    })
    expect(planProposal(chosen, ['訳'])).toEqual({ action: 'append', fillSlot: false })
  })

  /** A slot naming a candidate that has gone reads as the object's own lines. */
  it('leaves the slot alone where it names a candidate the object no longer holds', () => {
    const dangling = object({ lines: ['書いた'], translation: 'gone' })
    expect(planProposal(dangling, ['訳'])).toEqual({ action: 'append', fillSlot: false })
  })
})
