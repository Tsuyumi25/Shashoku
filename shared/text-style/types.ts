











export type TextDirection = 'horizontal' | 'vertical'


/**
 * Where a line short of the longest one sits inside the block.
 *
 * Named after the direction the text runs rather than after a side of the
 * page, so one stored value means the same thing set horizontally and set
 * vertically: `start` is the left of a row and the top of a column.
 */
export type TextAlign = 'start' | 'center' | 'end'


export type StrokePosition = 'inside' | 'center' | 'outside'


export interface StrokeEffect {
  kind: 'stroke'
  
  width: number
  
  color: string
  
  position: StrokePosition
}


export type TextEffect = StrokeEffect


export interface TextStyle {
  
  fontFamily: string
  
  fontSizePx: number
  
  direction: TextDirection

  align: TextAlign

  color: string
  
  leadingPercent: number

  /**
   * How far the strokes move from where the face drew them, in pixels of the
   * rendered bitmap. Negative thins, positive thickens, zero leaves the face
   * alone.
   *
   * Not an effect. An effect is something added on top of the letter — the
   * stroke draws a band the reader can see the colour of — while this changes
   * what the letter itself is. Doing it with the stroke would say the feature
   * is a stroke, and then a label that wanted both would have nowhere to put
   * the second one.
   *
   * Absolute pixels rather than a fraction of the size, because the case that
   * asks for it is a face that reads too heavy once it is set large, and the
   * fix there is a thickness rather than a ratio. The cost is that changing
   * `fontSizePx` afterwards changes how much of the letter this is.
   *
   * ⚠️ The two directions are not equally safe. Thinning is exact — the edge
   * moves by the amount asked for and nothing else happens. Thickening runs
   * out when neighbouring strokes meet, and CJK runs out early: past that
   * point the counters close and the letter turns into a blob.
   */
  weightPx: number

  effects: TextEffect[]
}


export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: '',
  fontSizePx: 24,
  direction: 'horizontal',
  align: 'start',
  color: '#000000',
  leadingPercent: 120,
  weightPx: 0,
  effects: [],
}
