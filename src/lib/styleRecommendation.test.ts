import { describe, expect, it } from 'vitest'
import type { TagRegistry } from '@shared/tags/types'
import type { TextStyle } from '@shared/text-style/types'
import { DEFAULT_TEXT_STYLE } from '@shared/text-style/types'
import type { BucketObject } from '@/lib/valueBuckets'
import { deriveStyle, tagChain } from '@/lib/styleRecommendation'

const REGISTRY: TagRegistry = [
  { name: 'inside', color: '#f00' },
  { name: 'outside', color: '#0f0' },
  { name: 'emphasis', color: '#00f' },
]

const SEED: TextStyle = { ...DEFAULT_TEXT_STYLE, fontFamily: 'Seed', fontSizePx: 24 }

let serial = 0
function obj(tags: string[], style: Partial<TextStyle>): BucketObject {
  return {
    id: `o${++serial}`,
    pageId: 'p001.png',
    tags,
    style: { ...DEFAULT_TEXT_STYLE, ...style },
  }
}

function copies(n: number, tags: string[], style: Partial<TextStyle>): BucketObject[] {
  return Array.from({ length: n }, () => obj(tags, style))
}

describe('tagChain', () => {
  it('drops from the tail of the order the project set', () => {
    expect(tagChain(['emphasis', 'outside'], REGISTRY)).toEqual([
      ['outside', 'emphasis'],
      ['outside'],
    ])
  })

  it('drops what the registry does not name first, since nobody placed those', () => {
    expect(tagChain(['mine', 'outside'], REGISTRY)).toEqual([['outside', 'mine'], ['outside']])
  })

  /**
   * "What have I not classified yet" is a different question from what a
   * meaning looks like, so the walk stops before the empty set rather than
   * ending at every untagged object in the project.
   */
  it('never reaches the empty set', () => {
    expect(tagChain(['outside'], REGISTRY)).toEqual([['outside']])
    expect(tagChain([], REGISTRY)).toEqual([])
  })
})

describe('deriveStyle', () => {
  it('falls to the seed when the project holds no sample at all', () => {
    expect(deriveStyle([], ['outside'], REGISTRY, SEED)).toEqual(SEED)
  })

  it('falls to the seed for an object carrying no tags', () => {
    const objects = copies(9, [], { fontFamily: 'Untagged', fontSizePx: 40 })
    expect(deriveStyle(objects, [], REGISTRY, SEED)).toEqual(SEED)
  })

  /**
   * The n=1 case, which is the one that runs while a chapter is being started:
   * the degenerate behaviour is "the same as the last one", with no rule of its
   * own saying so.
   */
  it('copies the only sample there is', () => {
    const only = obj(['outside'], { fontFamily: 'Mincho', fontSizePx: 33, color: '#123456' })
    const derived = deriveStyle([only], ['outside'], REGISTRY, SEED)
    expect(derived).toEqual(only.style)
  })

  it('takes the whole skeleton from the biggest bucket', () => {
    const objects = [
      ...copies(5, ['outside'], { fontFamily: 'Mincho', color: '#000000' }),
      ...copies(3, ['outside'], { fontFamily: 'Gothic', color: '#ffffff' }),
    ]
    const derived = deriveStyle(objects, ['outside'], REGISTRY, SEED)
    expect(derived.fontFamily).toBe('Mincho')
    expect(derived.color).toBe('#000000')
  })

  /**
   * The bucket is the unit, not the field. Counting votes per field would build
   * a combination no object in the project has ever held.
   */
  it('never assembles a combination out of separate winners', () => {
    const objects = [
      ...copies(5, ['outside'], { fontFamily: 'Mincho', color: '#000000' }),
      ...copies(3, ['outside'], { fontFamily: 'Mincho', color: '#ffffff' }),
      ...copies(3, ['outside'], { fontFamily: 'Gothic', color: '#ffffff' }),
    ]
    const derived = deriveStyle(objects, ['outside'], REGISTRY, SEED)
    expect(derived.fontFamily).toBe('Mincho')
    expect(derived.color).toBe('#000000')
  })

  it('drops the tail of the tag set until a station has samples', () => {
    const objects = copies(4, ['outside'], { fontFamily: 'Mincho' })
    const derived = deriveStyle(objects, ['outside', 'emphasis'], REGISTRY, SEED)
    expect(derived.fontFamily).toBe('Mincho')
  })

  it('prefers the exact tag set over the station below it', () => {
    const objects = [
      ...copies(30, ['outside'], { fontFamily: 'Mincho' }),
      ...copies(1, ['outside', 'emphasis'], { fontFamily: 'Gothic' }),
    ]
    const derived = deriveStyle(objects, ['outside', 'emphasis'], REGISTRY, SEED)
    expect(derived.fontFamily).toBe('Gothic')
  })

  describe('size', () => {
    it('takes the most frequent inside the winning bucket, not across the group', () => {
      const objects = [
        ...copies(5, ['outside'], { fontFamily: 'Mincho', fontSizePx: 18 }),
        ...copies(4, ['outside'], { fontFamily: 'Gothic', fontSizePx: 48, color: '#000000' }),
        ...copies(4, ['outside'], { fontFamily: 'Gothic', fontSizePx: 48, color: '#ffffff' }),
      ]
      expect(deriveStyle(objects, ['outside'], REGISTRY, SEED).fontSizePx).toBe(18)
    })

    it('falls to the seed size when the winning bucket is too scattered', () => {
      const scattered = Array.from({ length: 40 }, (_, i) =>
        obj(['outside'], { fontFamily: 'Mincho', fontSizePx: 10 + i }),
      )
      const derived = deriveStyle(scattered, ['outside'], REGISTRY, SEED, 0.5)
      expect(derived.fontFamily).toBe('Mincho')
      expect(derived.fontSizePx).toBe(SEED.fontSizePx)
    })

    it('keeps the size once its share clears the threshold', () => {
      const objects = [
        ...copies(6, ['outside'], { fontFamily: 'Mincho', fontSizePx: 20 }),
        ...copies(4, ['outside'], { fontFamily: 'Mincho', fontSizePx: 31 }),
      ]
      expect(deriveStyle(objects, ['outside'], REGISTRY, SEED, 0.5).fontSizePx).toBe(20)
    })
  })

  /**
   * The face is not a compared field, so a bucket can hold two weights of one
   * family and the representative's face is whichever object landed first.
   */
  it('takes the most frequent face in the bucket rather than a member at random', () => {
    const objects = [
      obj(['outside'], { fontFamily: 'Noto', fontFace: 'Noto-Bold', fontStyleName: 'Bold' }),
      ...copies(4, ['outside'], {
        fontFamily: 'Noto',
        fontFace: 'Noto-Regular',
        fontStyleName: 'Regular',
      }),
    ]
    const derived = deriveStyle(objects, ['outside'], REGISTRY, SEED)
    expect(derived.fontFace).toBe('Noto-Regular')
    expect(derived.fontStyleName).toBe('Regular')
  })
})
