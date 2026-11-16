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

  /**
   * Absent: this text object's outermost stroke is not drawn over the text
   * objects under it whose outermost stroke is of the same colour, and theirs
   * stays off it too. Two bands of one colour overlapping cannot be told
   * apart, so a band crossing a letter is the only way the two can be seen to
   * fight. `false` lets them, for the depth an overlap is sometimes meant to
   * show. Set on every stroke of the object alike, since which one is
   * outermost moves as they are edited.
   */
  joins?: false
}


/**
 * A soft halo blurred out of everything the node draws, strokes included, laid
 * under it. Independent of the strokes: a stroke is a hard band grown from the
 * edge, this is the edge smeared outwards, and a label may want both.
 *
 * The fields are Photoshop's Outer Glow, minus what only Photoshop offers
 * (technique, contour, range, noise, jitter), because letterers arrive from it.
 */
export interface GlowEffect {
  kind: 'glow'

  /** How far past the edge the halo reaches, in page pixels: Photoshop's Size. */
  size: number

  /**
   * Percent of `size` the shape is grown solid before the rest is blurred,
   * 0–100: Photoshop's Spread. 0 starts fading at the edge, 100 is a hard band.
   */
  spread: number

  /** Its colour; the alpha is the halo's opacity. */
  color: string

  /** How the halo meets what is under the node. One of the layer blend modes, never pass-through. */
  blendMode: string
}


export type LayerEffect = StrokeEffect | GlowEffect


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


/**
 * White, since a halo is mostly asked for to lift dark letters off dark
 * artwork; screen, which is what Photoshop's and Illustrator's glows start as.
 */
export const DEFAULT_GLOW: GlowEffect = {
  kind: 'glow',
  size: 8,
  spread: 0,
  color: '#ffffffff',
  blendMode: 'screen',
}
