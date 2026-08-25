/**
 * How a source reads on the canvas: one colour for all of them, over a white
 * halo.
 *
 * ⭐ Viewing conditions, not taste. A source is usually read while the artwork
 * it came off is still un-lettered — black line art, screentone, the original
 * text still under it — so a body set in whatever colour the seed style
 * happened to carry is a sentence somebody has to hunt for. One colour makes
 * every source on the page the same kind of thing at a glance, and the halo is
 * what makes any of them legible over the drawing.
 *
 * ⚠️ The canvas only. The compositor draws the translation and never asks about
 * this — a page exports as what it should say, and a reference treatment
 * appearing in an exported page would be a working note printed in the book.
 *
 * ⚠️ This overrides the appearance a source body carries in its own style,
 * which means the style panel's colour does nothing while the source is the
 * side being worked on. That is a real inconsistency and it is left standing on
 * purpose: who owns a source's appearance is not settled, and the source's part
 * in the work is small enough that the answer wants a few weeks of use rather
 * than a decision now. The geometry — size, direction, position, angle — is
 * untouched, because that half *was* measured off the artwork and is a person's
 * to correct.
 */
import type { LayerEffect } from '@shared/effects/types'
import type { TextStyle } from '@shared/text-style/types'

/**
 * Blue: the one hue the pages here almost never contain. Black and white are
 * the artwork, red is what the artwork uses for emphasis, and a source has to
 * be told apart from all of it at a glance.
 */
export const SOURCE_COLOR = '#1d4ed8'

/** Wide enough to hold a line of dialogue off busy line art, and no wider. */
export const SOURCE_HALO: LayerEffect = {
  kind: 'stroke',
  width: 4,
  color: '#ffffff',
  position: 'outside',
}

/** What a source is drawn with, whatever it carries. */
export function sourceLook(style: TextStyle): { style: TextStyle; effects: LayerEffect[] } {
  return { style: { ...style, color: SOURCE_COLOR }, effects: [SOURCE_HALO] }
}
