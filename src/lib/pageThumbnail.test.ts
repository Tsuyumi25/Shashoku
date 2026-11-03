import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@/types/project'
import type { SourceTextLayerEntry, TranslationTextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { thumbnailKey } from '@/lib/pageThumbnail'
import { emptyCounters } from '@shared/page/numbers'
import { blankSourceBlock, blankTranslationBlock } from '@shared/page/schema'

const FACE = 'f'

function page(): ProjectFile {
  return {
    pageId: '001.png',
    pageDir: '/p/.shashoku/pages/001',
    badge: 'ok',
    ocr: { schemaVersion: OCR_SCHEMA_VERSION, width: 1200, height: 1700, candidates: [] },
    page: {
      schemaVersion: MANIFEST_SCHEMA_VERSION,
      revision: 0,
      name: 'p',
      width: 1200,
      height: 1700,
      ledgers: { [FACE]: { units: [{ id: 'u', members: ['s', 'a'] }] } },
      readingOrder: ['s'],
      readingEdges: [],
      counters: emptyCounters(),
      layers: [
        blankTranslationBlock('a', FACE, DEFAULT_TEXT_STYLE),
        blankSourceBlock('s', DEFAULT_TEXT_STYLE),
      ],
    },
  }
}

const textOn = (file: ProjectFile) => file.page.layers[0] as TranslationTextLayerEntry

const sourceOn = (file: ProjectFile) => file.page.layers[1] as SourceTextLayerEntry

/** What a thumbnail is a picture of, and nothing else, decides its key. */
describe('thumbnailKey', () => {
  it('changes when the page is retyped', async () => {
    const edited = page()
    textOn(edited).body.lines = ['なるほど']

    expect(await thumbnailKey(edited, FACE)).not.toBe(await thumbnailKey(page(), FACE))
  })

  it('changes when an object is restyled', async () => {
    const edited = page()
    textOn(edited).body.style = { ...DEFAULT_TEXT_STYLE, fontSizePx: 48 }

    expect(await thumbnailKey(edited, FACE)).not.toBe(await thumbnailKey(page(), FACE))
  })

  /**
   * ⭐ What the block reads as is what is on the artwork, so picking a proposal
   * is a change to the picture — while the pool it was picked out of is not.
   */
  it('changes when a block is set to read as one of its proposals', async () => {
    const picked = page()
    textOn(picked).body.candidates = [{ id: 'c', lines: ['なるほど'] }]
    const pooled = await thumbnailKey(picked, FACE)
    textOn(picked).body.chosen = 'c'

    expect(pooled).toBe(await thumbnailKey(page(), FACE))
    expect(await thumbnailKey(picked, FACE)).not.toBe(pooled)
  })

  /**
   * A tag says what an object means, not what it looks like. Hashing it would
   * throw away every thumbnail in the chapter for a classification pass that
   * changed no pixel.
   */
  it('is unchanged by the artwork being tagged', async () => {
    const tagged = page()
    sourceOn(tagged).body.tags = ['心聲']

    expect(await thumbnailKey(tagged, FACE)).toBe(await thumbnailKey(page(), FACE))
  })

  // Reading order decides which object comes first in the label list, never
  // what the page looks like.
  it('is unchanged by the page being reordered for reading', async () => {
    const reordered = page()
    reordered.page.readingOrder = ['zz', 's']

    expect(await thumbnailKey(reordered, FACE)).toBe(await thumbnailKey(page(), FACE))
  })

  /** ⚠️ Another face's lettering moves no pixel of this one's page. */
  it('is unchanged by a second face being lettered', async () => {
    const twoFaced = page()
    twoFaced.page.layers.push(blankTranslationBlock('b', 'other', DEFAULT_TEXT_STYLE))

    expect(await thumbnailKey(twoFaced, FACE)).toBe(await thumbnailKey(page(), FACE))
  })

  /** Which is what makes one page two pictures: each face is lettered its own way. */
  it('separates the faces it is asked to draw', async () => {
    expect(await thumbnailKey(page(), 'other')).not.toBe(await thumbnailKey(page(), FACE))
  })

  it('separates pages that hold the same labels', async () => {
    const other = { ...page(), pageDir: '/p/.shashoku/pages/002' }

    expect(await thumbnailKey(other, FACE)).not.toBe(await thumbnailKey(page(), FACE))
  })

  it('separates the sizes it is asked to draw', async () => {
    expect(await thumbnailKey(page(), FACE, 320)).not.toBe(await thumbnailKey(page(), FACE, 640))
  })
})
