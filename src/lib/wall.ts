import { ref } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import { TEXT_STYLE_FIELDS } from '@shared/text-style/schema'

/** How a piece of text is shown on the wall, against the size it is set at. */
export type WallSize = 'uniform' | 'eased' | 'proportional'

/** Shared by the wall and the controls standing beside it in the left column. */
export const wallSize = ref<WallSize>('eased')

/**
 * What counts as looking alike. The face alone to begin with: gathering by
 * face is nearly all the wall is asked for, while size and scale are read off
 * the pieces themselves — square-root sizing shows them without splitting
 * anything apart. The rest stay a toggle away.
 */
export const wallFields = ref(new Set<keyof TextStyle>(['fontFamily']))

/** The fields besides the face, which are rarely what a bucket is made of. */
export const WALL_RARE_FIELDS = TEXT_STYLE_FIELDS.filter((f) => f !== 'fontFamily')

export type WallScope = 'page' | 'chapter'
export const wallScope = ref<WallScope>('chapter')

/**
 * The size, in screen pixels, a piece set at `sizePx` is shown at.
 *
 * Uniform shows every face at one size, so faces compare and sizes do not.
 * Eased takes the square root, keeping the order of sizes while pulling a 368px
 * shout and a 47px aside within reach of one screen. Proportional keeps their
 * ratio, scaled down — never their size on the page, which would not fit.
 */
export function shownEm(sizePx: number, mode: WallSize): number {
  if (mode === 'uniform') return 28
  if (mode === 'eased') return 3.6 * Math.sqrt(sizePx)
  return sizePx * 0.22
}
