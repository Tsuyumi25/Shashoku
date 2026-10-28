import type { TagRegistry } from '@shared/tags/types'
import type { TextStyle } from '@shared/text-style/types'
import { tagSetKey, tagsInRegistryOrder } from '@shared/tags/set'
import { FONT_FIELDS, SKELETON_FIELDS } from '@shared/text-style/fields'
import { groupByValue, type BucketObject, type StyleBucket, type TagGroup } from '@/lib/valueBuckets'

/**
 * How much of the winning bucket has to agree on a size before it counts as a
 * choice rather than as the arithmetic of fitting text into bubbles.
 *
 * The denominator is the bucket, never the project: a category of six in a
 * chapter of two hundred would never clear a project-wide bar however perfectly
 * consistent it is, and how rare a category is says nothing about how tightly
 * it is set. A starting value, to be set against a chapter that has actually
 * been typeset.
 *
 * ⚠️ This is the one place where the head of a row is not what was applied. A
 * size that fails to clear it is not written — the object keeps the project's
 * seed size — while the row still offers the sizes the category does reach for.
 * Every other parameter leads its row with the value the derivation wrote.
 */
export const SIZE_SHARE_THRESHOLD = 0.05

/**
 * The stations a derivation walks, the whole tag set first and one tag shorter
 * each step. Dropping from the tail is the registry's own claim: the order is a
 * priority the user set, and tags it does not name were never placed by anyone,
 * so they carry the least.
 *
 * The empty set is not a station. "What have I not classified yet" is a
 * different question from what a meaning looks like, and every untagged object
 * in the project would answer it.
 */
export function tagChain(tags: readonly string[], registry: TagRegistry): string[][] {
  const ordered = tagsInRegistryOrder(tags, registry)
  const out: string[][] = []
  for (let length = ordered.length; length > 0; length--) out.push(ordered.slice(0, length))
  return out
}

/** Fields lifted off one object to be put on another. */
function pick(style: TextStyle, fields: readonly (keyof TextStyle)[]): Partial<TextStyle> {
  const out: Partial<TextStyle> = {}
  for (const field of fields) Object.assign(out, { [field]: style[field] })
  return out
}

interface Tallied<T> {
  value: T
  count: number
}

/**
 * Ties are broken by which value was met first, and `Array#sort` is stable, so
 * two values a bucket holds equally often keep the order the objects are in.
 */
function tally<T>(values: readonly T[], key: (value: T) => string): Tallied<T>[] {
  const counts = new Map<string, Tallied<T>>()
  for (const value of values) {
    const k = key(value)
    const hit = counts.get(k)
    if (hit) hit.count += 1
    else counts.set(k, { value, count: 1 })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}

function indexById(objects: readonly BucketObject[]): Map<string, TextStyle> {
  return new Map(objects.map((o) => [o.id, o.style]))
}

/**
 * The bucket's members, which the bucket itself does not carry. Every member
 * agrees on the compared fields — that is what makes it a bucket — but the rest
 * of a style is decided by whichever member happened to land first, so anything
 * reading an uncompared field has to count instead of ask.
 */
function stylesOf(bucket: StyleBucket, byId: Map<string, TextStyle>): TextStyle[] {
  const out: TextStyle[] = []
  for (const id of bucket.ids) {
    const style = byId.get(id)
    if (style) out.push(style)
  }
  return out
}

function groupsByTagSet(
  objects: readonly BucketObject[],
  registry: TagRegistry,
): Map<string, TagGroup> {
  return new Map(groupByValue(objects, SKELETON_FIELDS, registry).map((g) => [g.key, g]))
}

/**
 * One style for an object about to carry `tags`, taken from what the project
 * already holds under that meaning.
 *
 * The whole skeleton comes from a single bucket, so the combination it names
 * has really been set at least once. Assembling each field from its own winner
 * would produce a style no object in the project has ever held — and the
 * software would be claiming it read that off the work.
 *
 * ⚠️ Read the sample before writing any of it back. Derived after the tags
 * land, the first station would hold the object itself and it would recommend
 * its own current style to itself.
 */
export function deriveStyle(
  objects: readonly BucketObject[],
  tags: readonly string[],
  registry: TagRegistry,
  seedStyle: TextStyle,
  sizeThreshold = SIZE_SHARE_THRESHOLD,
): TextStyle {
  const groups = groupsByTagSet(objects, registry)
  const byId = indexById(objects)

  for (const station of tagChain(tags, registry)) {
    const group = groups.get(tagSetKey(station))
    const winner = group?.buckets[0]
    if (!winner) continue
    const members = stylesOf(winner, byId)
    if (members.length === 0) continue

    const font = tally(members, (s) => JSON.stringify(pick(s, FONT_FIELDS)))[0]!
    const size = tally(members, (s) => String(s.fontSizePx))[0]!
    const clears = size.count / members.length >= sizeThreshold

    return {
      ...winner.style,
      ...pick(font.value, FONT_FIELDS),
      fontSizePx: clears ? size.value.fontSizePx : seedStyle.fontSizePx,
    }
  }

  return { ...seedStyle }
}
