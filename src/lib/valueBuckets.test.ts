import { describe, expect, it } from 'vitest'
import type { TagDefinition } from '@shared/tags/types'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { groupByValue, type BucketObject } from './valueBuckets'

const registry: TagDefinition[] = [
  { name: '框内', color: '#ff0000' },
  { name: '心聲', color: '#0000ff' },
]

function object(id: string, tags: string[], style: Partial<TextStyle> = {}): BucketObject {
  return {
    id,
    filename: '001.png',
    tags,
    style: { ...DEFAULT_TEXT_STYLE, ...style },
  }
}

const ALL: (keyof TextStyle)[] = []

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
    expect(groups[0].drifting).toBe(false)
    expect(groups[0].buckets).toHaveLength(1)
  })

  it('calls a group whose objects disagree drifting', () => {
    const groups = groupByValue(
      [object('a', ['框内']), object('b', ['框内'], { fontSizePx: 48 })],
      ALL,
      registry,
    )
    expect(groups[0].drifting).toBe(true)
    expect(groups[0].buckets.map((b) => b.ids)).toEqual([['a'], ['b']])
  })

  /** "Who is not using the dialogue font" is a narrower question than "who disagrees". */
  it('only looks at the fields it was asked about', () => {
    const objects = [object('a', ['框内']), object('b', ['框内'], { fontSizePx: 48 })]
    expect(groupByValue(objects, ['fontFamily'], registry)[0].drifting).toBe(false)
    expect(groupByValue(objects, ['fontSizePx'], registry)[0].drifting).toBe(true)
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

  it('lists drifting groups first, since they are the only ones to act on', () => {
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

  /** A different job from asking whether a group agrees with itself. */
  it('leaves untagged objects to the end', () => {
    const groups = groupByValue([object('a', []), object('b', ['框内'])], ALL, registry)
    expect(groups.map((g) => g.tags)).toEqual([['框内'], []])
  })
})
