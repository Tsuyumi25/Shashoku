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


/**
 * What the node draws, turned into a sheet of screentone film: black dots on
 * clear, bigger where it is darker, so a picture keeps its shading as dots the
 * way a printed page carries it and the page shows between them. On text only
 * the letters' fill is screened; the strokes lie over it as they were.
 *
 * The dots sit on a grid fixed to the page, so tone on neighbouring objects
 * lines up and moving an object does not drag its dots along.
 */
export interface ToneEffect {
  kind: 'tone'

  /**
   * Distance between neighbouring dot centres, in page pixels. Not lines per
   * inch: a page here has no print size to measure an inch against, and what
   * gets matched is the dots on the artwork, which are counted in its pixels.
   */
  spacing: number

  /** The angle the rows of dots run at, in degrees. */
  angle: number

  /**
   * How much of each cell a dot covers: `'image'` reads it from the picture,
   * one minus its brightness, times its alpha; a number is that percent times
   * the alpha. Through the alpha a soft brush's edge thins into smaller dots.
   */
  density: 'image' | number
}


export type LayerEffect = StrokeEffect | GlowEffect | ToneEffect


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


/**
 * Ten pixels between dots is 60 lines at 600 dpi, the commonest pairing in
 * digital manga; 45 degrees is how tone is usually laid.
 */
export const DEFAULT_TONE: ToneEffect = {
  kind: 'tone',
  spacing: 10,
  angle: 45,
  density: 'image',
}
