import type { TagRegistry } from '@shared/tags/types'
import type { TextStyle } from '@shared/text-style/types'
import { tagSetKey, tagsInRegistryOrder } from '@shared/tags/set'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'

/** One text object, flattened to what a bucket needs to know about it. */
export interface BucketObject {
  id: string
  filename: string
  tags: string[]
  style: TextStyle
}

export interface StyleBucket {
  key: string
  ids: string[]
  /** Every member agrees on the compared fields, so any of them will do. */
  style: TextStyle
}

export interface TagGroup {
  key: string
  /** In the project's own order, so the list reads the way the registry does. */
  tags: string[]
  count: number
  buckets: StyleBucket[]
  /**
   * Objects that mean the same thing do not look the same. The whole point of
   * the view: with the styles held by value there is nothing keeping a group
   * consistent, so the way to find out is to look.
   */
  drifting: boolean
}

function styleKey(style: TextStyle, fields: readonly (keyof TextStyle)[]): string {
  return JSON.stringify(fields.map((field) => style[field]))
}

/**
 * The objects gathered twice: first by what they mean, then by what they look
 * like. A group holding more than one bucket is drift.
 *
 * `fields` narrows what counts as looking alike, so "who is not using the
 * dialogue font" is one question and "who disagrees about anything at all" is
 * another, asked of the same list.
 */
export function groupByValue(
  objects: readonly BucketObject[],
  fields: readonly (keyof TextStyle)[],
  registry: TagRegistry,
): TagGroup[] {
  const compared = fields.length > 0 ? fields : TEXT_STYLE_FIELDS
  const groups = new Map<string, BucketObject[]>()
  for (const object of objects) {
    const key = tagSetKey(object.tags)
    const bucket = groups.get(key)
    if (bucket) bucket.push(object)
    else groups.set(key, [object])
  }

  const out: TagGroup[] = []
  for (const [key, members] of groups) {
    const byStyle = new Map<string, BucketObject[]>()
    for (const object of members) {
      const sk = styleKey(object.style, compared)
      const bucket = byStyle.get(sk)
      if (bucket) bucket.push(object)
      else byStyle.set(sk, [object])
    }

    const buckets: StyleBucket[] = [...byStyle].map(([sk, bucketMembers]) => ({
      key: `${key}|${sk}`,
      ids: bucketMembers.map((o) => o.id),
      style: bucketMembers[0].style,
    }))
    buckets.sort((a, b) => b.ids.length - a.ids.length)

    out.push({
      key,
      tags: tagsInRegistryOrder(members[0].tags, registry),
      count: members.length,
      buckets,
      drifting: buckets.length > 1,
    })
  }

  // Drift first: it is the only thing here anybody has to act on. Untagged
  // objects last, since "what have I not classified yet" is a different job
  // from "does this group agree with itself".
  const rank = (group: TagGroup) => registry.findIndex((tag) => group.tags.includes(tag.name))
  out.sort((a, b) => {
    if (a.drifting !== b.drifting) return a.drifting ? -1 : 1
    if (a.tags.length === 0 || b.tags.length === 0) return a.tags.length === 0 ? 1 : -1
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return (ra === -1 ? Infinity : ra) - (rb === -1 ? Infinity : rb)
    return b.count - a.count
  })
  return out
}
