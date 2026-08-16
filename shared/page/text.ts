import type { TextLayerEntry } from './types'

/**
 * The two directions between a text object's stored lines and the single string
 * an editor binds to. Named rather than inlined so the split and the join stay
 * each other's inverse — `lines` refuses an embedded newline at parse, and that
 * only holds if every writer breaks on the same thing every reader joins on.
 */

/** What the object reads as, once the translation slot has been resolved. */
export function textOf(entry: Pick<TextLayerEntry, 'lines' | 'translations' | 'translation'>): string {
  return linesFor(entry).join('\n')
}

/**
 * ⭐ The one place the slot is resolved, which is what keeps picking a
 * translation from overwriting anything: `lines` stays exactly as typed, and
 * emptying the slot brings it back word for word.
 *
 * A slot naming a candidate the pool no longer holds reads as empty rather than
 * as blank text — the object still has its own lines, and showing nothing would
 * lose them to a dangling pointer.
 */
export function linesFor(
  entry: Pick<TextLayerEntry, 'lines' | 'translations' | 'translation'>,
): readonly string[] {
  if (entry.translation === null) return entry.lines
  return entry.translations.find((c) => c.id === entry.translation)?.lines ?? entry.lines
}

export function linesOf(text: string): string[] {
  return text.split('\n')
}
