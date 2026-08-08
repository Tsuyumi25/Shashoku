import type { TextStyle } from './types'

/**
 * The fields whose value was chosen rather than computed.
 *
 * Chosen: there were alternatives, one was picked out of a set, and every
 * appearance of it is somebody's intent. Computed: the value is a by-product
 * of fitting content into the space it has, which is nobody's intent.
 *
 * This is a claim about what the fields are, not about how any one person
 * works — "size is arrived at by fitting text into a bubble" stays true across
 * projects, while "size varies in this person's work" would drift and could
 * not be written down anywhere.
 */
export const SKELETON_FIELDS = [
  'fontFamily',
  'direction',
  'align',
  'color',
  'leadingPercent',
  'weightPx',
  'effects',
] as const satisfies readonly (keyof TextStyle)[]

/**
 * The computed half. A line squeezed to fit its bubble is not a different kind
 * of text: bubble width, bubble height, character count, line count and
 * punctuation all add into this one number, so it spreads out however tidy the
 * work is. Anything reading it as evidence of a choice needs a threshold first.
 *
 * Leading stays out of here because it is a percentage — it does not move with
 * the size, so it carries none of that spread.
 */
export const SKIN_FIELDS = ['fontSizePx'] as const satisfies readonly (keyof TextStyle)[]

/**
 * The two font strings that travel with the family instead of being compared
 * beside it. `fontFace` is an identity rather than a readable property, and two
 * names can reach one face; `fontStyleName` is that face's name, which
 * resolution never compares. Either one compared on its own would split objects
 * a reader sees as identical, and the split would be invisible on the page.
 */
export const CARRIED_WITH_FAMILY = ['fontFace', 'fontStyleName'] as const satisfies readonly (keyof TextStyle)[]

/** The family and the two names it drags along — one font, as a person picks it. */
export const FONT_FIELDS = ['fontFamily', ...CARRIED_WITH_FAMILY] as const
