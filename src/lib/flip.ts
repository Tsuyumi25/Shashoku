import type { TextBody } from '@shared/page/types'

/** Which of a text object's own axes it is mirrored along. */
export interface Flip {
  x: boolean
  y: boolean
}

export const NO_FLIP: Flip = { x: false, y: false }

export function flipOf(body: Pick<TextBody, 'flipX' | 'flipY'>): Flip {
  return { x: body.flipX === true, y: body.flipY === true }
}

/** Each axis's sign: -1 where mirrored. */
export function signsOf(flip: Flip): { x: 1 | -1; y: 1 | -1 } {
  return { x: flip.x ? -1 : 1, y: flip.y ? -1 : 1 }
}

/**
 * How a turned, mirrored object is drawn from a bitmap the engine turned and
 * nothing else: R(θ)·S(sx, sy) is S(sx, sy)·R(−θ) when one axis is mirrored,
 * and R(θ + π) when both are. So the engine is asked for that angle and the
 * bitmap is mirrored in the page's own axes where it lands.
 */
export function drawnTurn(rotation: number, flip: Flip): { turn: number; mirror: { x: 1 | -1; y: 1 | -1 } } {
  if (flip.x && flip.y) return { turn: rotation + Math.PI, mirror: { x: 1, y: 1 } }
  if (flip.x || flip.y) return { turn: -rotation, mirror: signsOf(flip) }
  return { turn: rotation, mirror: { x: 1, y: 1 } }
}

/** A fractional point of the frame as drawn, read in the frame before it was mirrored. */
export function unmirrored(ratio: { x: number; y: number }, flip: Flip): { x: number; y: number } {
  return { x: flip.x ? 1 - ratio.x : ratio.x, y: flip.y ? 1 - ratio.y : ratio.y }
}
