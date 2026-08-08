import type { TextEffect, TextStyle } from './types'

/**
 * A copy that shares nothing with the list it came from. Everything else in a
 * style is a string or a number, so this is the only part of one that two
 * objects could end up holding between them.
 */
export function cloneEffects(effects: readonly TextEffect[]): TextEffect[] {
  return effects.map((effect) => ({ ...effect }))
}

/**
 * Needed wherever a style crosses from one object to another. An object's own
 * style is only ever rebuilt from a patch, so nothing there shares structure —
 * but a style read off one object and written onto a second would hand both of
 * them the same array, and the first in-place edit to an effect would then
 * change a label nobody was looking at.
 */
export function cloneTextStyle(style: TextStyle): TextStyle {
  return { ...style, effects: cloneEffects(style.effects) }
}
