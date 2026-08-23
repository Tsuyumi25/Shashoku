/**
 * What a node carries on top of what it is.
 *
 * Held by the node rather than by the text style these started out in, because
 * "what is added on top of this" is a question about a node and not about
 * typesetting: a raster layer has no style to hang one off, and the band grown
 * from its edge is the same band grown from a letter's.
 */


export type StrokePosition = 'inside' | 'center' | 'outside'


/**
 * A band grown from the content's own edge rather than swept along its outline,
 * which is why it offers a position and a width and no joins or caps.
 */
export interface StrokeEffect {
  kind: 'stroke'

  width: number

  color: string

  position: StrokePosition
}


export type LayerEffect = StrokeEffect


/**
 * What turning the stroke on gives you before anything has been adjusted —
 * visible against artwork of any colour, and wide enough to read at label
 * sizes.
 */
export const DEFAULT_STROKE: StrokeEffect = {
  kind: 'stroke',
  width: 3,
  color: '#000000',
  position: 'outside',
}
