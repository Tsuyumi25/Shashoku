import { RESERVED_TAG_NAMES } from '../ssk/constants'
import type { TagDefinition, TagRegistry } from './types'

/** What a tag no registry entry names draws in. */
export const UNKNOWN_TAG_COLOR = 'rgb(128, 128, 128)'

/**
 * An object's tags are a set: `["a","b"]` and `["b","a"]` say the same thing.
 * The stored form is deduplicated and sorted by code unit so that two objects
 * carrying the same tags are byte-identical on disk, which is what lets a
 * group-by-value view tell a real drift from a difference in write order.
 *
 * Sorted by code unit rather than by locale on purpose: this is the persisted
 * order, and a collation that moves with the reader's locale would rewrite
 * files for no reason.
 */
export function normalizeTagSet(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const tag of tags) {
    const trimmed = tag.trim()
    if (trimmed.length > 0) seen.add(trimmed)
  }
  return [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export function sameTagSet(a: readonly string[], b: readonly string[]): boolean {
  const na = normalizeTagSet(a)
  const nb = normalizeTagSet(b)
  return na.length === nb.length && na.every((tag, i) => tag === nb[i])
}

/** A stable key for bucketing objects by the tags they carry. */
export function tagSetKey(tags: readonly string[]): string {
  // Escaped rather than written out: a literal NUL in the source makes the
  // whole file binary to ripgrep, which then skips it without saying so.
  return normalizeTagSet(tags).join('\u0000')
}

export function hasTag(tags: readonly string[], tag: string): boolean {
  return tags.includes(tag)
}

export function withTag(tags: readonly string[], tag: string): string[] {
  return normalizeTagSet([...tags, tag])
}

export function withoutTag(tags: readonly string[], tag: string): string[] {
  return normalizeTagSet(tags.filter((t) => t !== tag))
}

/** Why a name cannot be a tag, or null. A reserved name would make the page unreadable on the next load. */
export function tagNameRefusal(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return '標記不能是空白'
  if (RESERVED_TAG_NAMES.includes(trimmed)) return `「${trimmed}」是保留字（${RESERVED_TAG_NAMES.join('、')}），不能當標記`
  return null
}

/**
 * Display order: registered tags in the order the project put them, then
 * whatever the registry does not name. Unknown tags come last because the
 * order is a priority the user set, and they never got to place these.
 */
export function tagsInRegistryOrder(
  tags: readonly string[],
  registry: TagRegistry,
): string[] {
  const normalized = normalizeTagSet(tags)
  const known: string[] = []
  for (const entry of registry) {
    if (normalized.includes(entry.name)) known.push(entry.name)
  }
  const unknown = normalized.filter((tag) => !known.includes(tag))
  return [...known, ...unknown]
}

/** The registry entry that decides an object's main colour, if any does. */
export function primaryTag(tags: readonly string[], registry: TagRegistry): TagDefinition | null {
  for (const entry of registry) {
    if (tags.includes(entry.name)) return entry
  }
  return null
}

export function tagColor(tag: string, registry: TagRegistry): string {
  return registry.find((entry) => entry.name === tag)?.color ?? UNKNOWN_TAG_COLOR
}

export function isRegisteredTag(tag: string, registry: TagRegistry): boolean {
  return registry.some((entry) => entry.name === tag)
}
