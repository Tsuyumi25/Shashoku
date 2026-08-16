import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@/types/project'
import type { TextLayerEntry } from '@shared/page/types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION } from '@shared/page/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import { thumbnailKey } from '@/lib/pageThumbnail'

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
      readingOrder: ['a'],
      readingEdges: [],
      layers: [
        {
          kind: 'text',
          id: 'a',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          x: 200,
          y: 150,
          tags: [],
          rotation: 0,
          lines: ['ふむ'],
          source: { hash: null, by: 'auto' },
          ownSource: '',
          translations: [],
          translation: null,
          style: { ...DEFAULT_TEXT_STYLE },
        },
      ],
    },
  }
}

const textOn = (file: ProjectFile) => file.page.layers[0] as TextLayerEntry

/** What a thumbnail is a picture of, and nothing else, decides its key. */
describe('thumbnailKey', () => {
  it('changes when the page is retyped', async () => {
    const edited = page()
    textOn(edited).lines = ['なるほど']

    expect(await thumbnailKey(edited)).not.toBe(await thumbnailKey(page()))
  })

  it('changes when an object is restyled', async () => {
    const edited = page()
    textOn(edited).style = { ...DEFAULT_TEXT_STYLE, fontSizePx: 48 }

    expect(await thumbnailKey(edited)).not.toBe(await thumbnailKey(page()))
  })

  /**
   * A tag says what an object means, not what it looks like. Hashing it would
   * throw away every thumbnail in the chapter for a classification pass that
   * changed no pixel.
   */
  it('is unchanged by an object being tagged', async () => {
    const tagged = page()
    textOn(tagged).tags = ['心聲']

    expect(await thumbnailKey(tagged)).toBe(await thumbnailKey(page()))
  })

  // Reading order decides which object comes first in the label list, never
  // what the page looks like.
  it('is unchanged by the page being reordered for reading', async () => {
    const reordered = page()
    reordered.page.readingOrder = ['zz', 'a']

    expect(await thumbnailKey(reordered)).toBe(await thumbnailKey(page()))
  })

  it('separates pages that hold the same labels', async () => {
    const other = { ...page(), pageDir: '/p/.shashoku/pages/002' }

    expect(await thumbnailKey(other)).not.toBe(await thumbnailKey(page()))
  })

  it('separates the sizes it is asked to draw', async () => {
    expect(await thumbnailKey(page(), 320)).not.toBe(await thumbnailKey(page(), 640))
  })
})
