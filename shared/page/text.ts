import type { TextBody } from './types'

/**
 * Which of a translation's two sides the interface is working on.
 *
 * A translation says two things and every surface that shows one of them — the
 * canvas, the frame around it, the style panel, the caret a keystroke lands in
 * — has to agree about which. Named rather than passed as a boolean so that a
 * call site reading `'source'` cannot be mistaken for one meaning "sourced".
 *
 * Two names rather than language tags. A third side would be a third name here
 * and nothing else would have to move, which is the point of the two being the
 * same kind of thing — but naming them by language before there is a third is
 * inventing a vocabulary nothing speaks yet.
 */
export type TextSide = 'translation' | 'source'

/**
 * The words in one block, as its own body holds them.
 *
 * ⚠️ Not what the block reads as. A translation block may be standing in for a
 * candidate the unit has chosen, and only the unit knows — see `linesAt` and
 * `projectionOf` in `units.ts`. Reaching for this to show a translation is how
 * a chosen candidate silently stops being shown.
 */
export function ownTextOf(body: TextBody): string {
  return body.lines.join('\n')
}

/**
 * The two directions between a body's stored lines and the single string an
 * editor binds to. Named rather than inlined so the split and the join stay
 * each other's inverse — `lines` refuses an embedded newline at parse, and that
 * only holds if every writer breaks on the same thing every reader joins on.
 */
export function linesOf(text: string): string[] {
  return text.split('\n')
}
