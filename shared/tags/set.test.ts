import { describe, expect, it } from 'vitest'
import type { TagDefinition } from './types'
import {
  UNKNOWN_TAG_COLOR,
  normalizeTagSet,
  primaryTag,
  sameTagSet,
  tagColor,
  tagSetKey,
  tagsInRegistryOrder,
} from './set'

const registry: TagDefinition[] = [
  { name: '框内', color: '#ff0000' },
  { name: '心聲', color: '#0000ff' },
]

describe('tags as a set', () => {
  /**
   * The one thing types cannot catch here. Two objects meaning the same thing
   * must compare equal however their tags were written down, or the group-by-
   * value view splits one bucket into two — and a split bucket looks exactly
   * like real drift, which is the thing that view exists to find.
   */
  it('reads the same tags written in either order as one set', () => {
    expect(sameTagSet(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(tagSetKey(['a', 'b'])).toBe(tagSetKey(['b', 'a']))
  })

  it('tells two different sets apart', () => {
    expect(sameTagSet(['a', 'b'], ['a'])).toBe(false)
    expect(sameTagSet(['a'], ['b'])).toBe(false)
  })

  it('counts a repeated tag once', () => {
    expect(normalizeTagSet(['a', 'a', 'b'])).toEqual(['a', 'b'])
    expect(sameTagSet(['a', 'a'], ['a'])).toBe(true)
  })

  it('drops whitespace-only tags and trims the rest', () => {
    expect(normalizeTagSet([' 框内 ', '   ', '心聲'])).toEqual(['心聲', '框内'])
  })
})

describe('display order', () => {
  it('follows the registry, not the stored order', () => {
    expect(tagsInRegistryOrder(['心聲', '框内'], registry)).toEqual(['框内', '心聲'])
  })

  /** The user never got to place these, so they cannot claim a position. */
  it('puts tags the registry does not know last', () => {
    expect(tagsInRegistryOrder(['角色/ゆみ', '心聲'], registry)).toEqual(['心聲', '角色/ゆみ'])
  })

  it('takes the main colour from whichever known tag sits highest', () => {
    expect(primaryTag(['心聲', '框内'], registry)?.color).toBe('#ff0000')
  })

  /**
   * The registry is advisory: an unregistered tag is data the user typed, and
   * losing its colour must not cost it anything else.
   */
  it('has no main colour when the registry knows none of the tags', () => {
    expect(primaryTag(['角色/ゆみ'], registry)).toBeNull()
    expect(tagColor('角色/ゆみ', registry)).toBe(UNKNOWN_TAG_COLOR)
  })
})
