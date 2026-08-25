import { describe, expect, it } from 'vitest'
import type { TagDefinition } from '@shared/tags/types'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import type { TextLayerEntry } from '@shared/page/types'
import { blankTextObject } from '@shared/page/schema'
import type { TextSide } from '@shared/page/text'
import { bucketObjectsOf, groupByValue, type BucketObject } from './valueBuckets'

const registry: TagDefinition[] = [
  { name: '框内', color: '#ff0000' },
  { name: '心聲', color: '#0000ff' },
]

function object(id: string, tags: string[], style: Partial<TextStyle> = {}): BucketObject {
  return {
    id,
    pageId: '001.png',
    tags,
    style: { ...DEFAULT_TEXT_STYLE, ...style },
  }
}

const ALL: (keyof TextStyle)[] = [
  'fontFamily',
  'fontSizePx',
  'direction',
  'align',
  'color',
  'leadingPercent',
]

describe('groupByValue', () => {
  it('gathers objects that mean the same thing, however their tags were written', () => {
    const groups = groupByValue(
      [object('a', ['框内', '心聲']), object('b', ['心聲', '框内'])],
      ALL,
      registry,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
  })

  it('shows the tags in the project order, not the stored one', () => {
    const groups = groupByValue([object('a', ['心聲', '框内'])], ALL, registry)
    expect(groups[0].tags).toEqual(['框内', '心聲'])
  })

  it('calls a group that agrees with itself settled', () => {
    const groups = groupByValue([object('a', ['框内']), object('b', ['框内'])], ALL, registry)
    expect(groups[0].manyStyles).toBe(false)
    expect(groups[0].buckets).toHaveLength(1)
  })

  it('calls a group whose objects disagree more than one style', () => {
    const groups = groupByValue(
      [object('a', ['框内']), object('b', ['框内'], { fontSizePx: 48 })],
      ALL,
      registry,
    )
    expect(groups[0].manyStyles).toBe(true)
    expect(groups[0].buckets.map((b) => b.ids)).toEqual([['a'], ['b']])
  })

  /** "Who is not using the dialogue font" is a narrower question than "who disagrees". */
  it('only looks at the fields it was asked about', () => {
    const objects = [object('a', ['框内']), object('b', ['框内'], { fontSizePx: 48 })]
    expect(groupByValue(objects, ['fontFamily'], registry)[0].manyStyles).toBe(false)
    expect(groupByValue(objects, ['fontSizePx'], registry)[0].manyStyles).toBe(true)
  })

  it('puts the biggest bucket first, so the odd one out is the short row', () => {
    const groups = groupByValue(
      [
        object('a', ['框内']),
        object('b', ['框内']),
        object('c', ['框内'], { fontSizePx: 48 }),
      ],
      ALL,
      registry,
    )
    expect(groups[0].buckets.map((b) => b.ids.length)).toEqual([2, 1])
  })

  it('lists split meanings first, since they are the only ones to act on', () => {
    const groups = groupByValue(
      [
        object('a', ['框内']),
        object('b', ['心聲']),
        object('c', ['心聲'], { fontSizePx: 48 }),
      ],
      ALL,
      registry,
    )
    expect(groups.map((g) => g.tags[0])).toEqual(['心聲', '框内'])
  })

  /**
   * Comparing on nothing is what the caller asked for, not a signal to compare
   * everything instead — every meaning becomes one bucket.
   */
  it('gathers a group into one bucket when nothing is being compared', () => {
    const groups = groupByValue(
      [object('a', ['框内']), object('b', ['框内'], { fontSizePx: 48 })],
      [],
      registry,
    )
    expect(groups[0].buckets).toHaveLength(1)
    expect(groups[0].manyStyles).toBe(false)
  })

  /** A different job from asking whether a group agrees with itself. */
  it('leaves untagged objects to the end', () => {
    const groups = groupByValue([object('a', []), object('b', ['框内'])], ALL, registry)
    expect(groups.map((g) => g.tags)).toEqual([['框内'], []])
  })
})

describe('which body the statistics count', () => {
  function twoBodied(id: string, sourcePx: number, translationPx: number): TextLayerEntry {
    const entry = blankTextObject(id, DEFAULT_TEXT_STYLE)
    entry.source = { ...entry.source, style: { ...DEFAULT_TEXT_STYLE, fontSizePx: sourcePx } }
    entry.translation = {
      ...entry.translation,
      style: { ...DEFAULT_TEXT_STYLE, fontSizePx: translationPx },
    }
    return entry
  }

  const page = [twoBodied('a', 41, 20), twoBodied('b', 37, 20)]

  it('reads the body it was asked about and not the other one', () => {
    expect(bucketObjectsOf('001.png', page, 'translation').map((o) => o.style.fontSizePx)).toEqual([
      20, 20,
    ])
  })

  /**
   * ⭐ Not an omission. "Your other objects are mostly 28px" says nothing to a
   * body whose size came off the drawing it is standing on, and offering it
   * would invite somebody to overwrite a measurement with a fashion.
   */
  it('has no pool for the source at all', () => {
    expect(bucketObjectsOf('001.png', page, 'source')).toEqual([])
  })

  /** Which is what makes one page two different statistics, asked one side at a time. */
  it('gives the two sides two different answers about the same objects', () => {
    const asked = (side: TextSide) => bucketObjectsOf('001.png', page, side).length
    expect(asked('translation')).toBe(2)
    expect(asked('source')).toBe(0)
  })
})
