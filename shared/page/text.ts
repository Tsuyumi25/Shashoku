import type { TextBody, TextLayerEntry, TranslationBody } from './types'

/**
 * Which of an object's two bodies of text the interface is working on.
 *
 * An object says two things and every surface that shows one of them — the
 * canvas, the frame around it, the style panel, the caret a keystroke lands in
 * — has to agree about which. Named rather than passed as a boolean so that a
 * call site reading `'source'` cannot be mistaken for one meaning "sourced".
 *
 * Two names rather than language tags. A third body would be a third name here
 * and nothing else would have to move, which is the point of the two being the
 * same kind of thing — but naming them by language before there is a third is
 * inventing a vocabulary nothing speaks yet.
 */
export type TextSide = 'translation' | 'source'

/**
 * ⭐ The one place the two sides are told apart. Every surface that shows an
 * object's text, position, angle or style goes through here, so a tool that
 * switches which side is being worked on switches all of them at once — and a
 * caret can never open on one side while the text under it comes from the
 * other.
 *
 * ⚠️ The compositor is not one of those surfaces. What a page exports as is
 * always the translation, whatever the interface happens to be showing.
 */
export function bodyOnSide(entry: TextLayerEntry, side: TextSide): TextBody {
  return side === 'source' ? entry.source : entry.translation
}

/** What the translation reads as, once its slot has been resolved. */
export function textOf(body: TranslationBody): string {
  return linesFor(body).join('\n')
}

/**
 * ⭐ The one place the slot is resolved, which is what keeps picking a
 * candidate from overwriting anything: `lines` stays exactly as typed, and
 * emptying the slot brings it back word for word.
 *
 * A slot naming a candidate the pool no longer holds reads as empty rather than
 * as blank text — the body still has its own lines, and showing nothing would
 * lose them to a dangling pointer.
 */
export function linesFor(body: TranslationBody): readonly string[] {
  if (body.chosen === null) return body.lines
  return body.candidates.find((c) => c.id === body.chosen)?.lines ?? body.lines
}

/**
 * Whether the translation reads as nothing at all — which is not the same as
 * having typed nothing into it. A body whose own lines are empty but whose slot
 * holds a candidate with text is translated, and every display saying otherwise
 * is reading past the resolution above.
 */
export function isBlank(body: TranslationBody): boolean {
  return linesFor(body).every((line) => line.length === 0)
}

/**
 * What a body says. Only the translation has a slot to resolve; a source says
 * its own lines and nothing else, which is the last asymmetry between them.
 */
export function textOfBody(body: TextBody): string {
  return isTranslation(body) ? textOf(body) : body.lines.join('\n')
}

export function textOnSide(entry: TextLayerEntry, side: TextSide): string {
  return textOfBody(bodyOnSide(entry, side))
}

function isTranslation(body: TextBody): body is TranslationBody {
  return 'chosen' in body
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
