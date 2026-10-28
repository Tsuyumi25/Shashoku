import { ref } from 'vue'
import type { WallAttribute } from '@/lib/wallAttributes'

/** How a piece of text is shown on the wall, against the size it is set at. */
export type WallSize = 'uniform' | 'eased' | 'proportional'

/** Shared by the wall and the controls standing beside it in the left column. */
export const wallSize = ref<WallSize>('eased')

/**
 * The one attribute the buckets gather by. One at a time, so every bucket names
 * a single value and its name says exactly what picking it picks; the face to
 * begin with, which is nearly all it is asked for.
 */
export const wallAttribute = ref<WallAttribute>('font')

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
