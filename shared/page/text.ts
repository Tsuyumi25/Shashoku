import type { TextLayerEntry } from './types'

/**
 * The two directions between a text object's stored lines and the single string
 * an editor binds to. Named rather than inlined so the split and the join stay
 * each other's inverse — `lines` refuses an embedded newline at parse, and that
 * only holds if every writer breaks on the same thing every reader joins on.
 */
export function textOf(entry: Pick<TextLayerEntry, 'lines'>): string {
  return entry.lines.join('\n')
}

export function linesOf(text: string): string[] {
  return text.split('\n')
}
