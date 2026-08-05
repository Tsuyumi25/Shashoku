











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

  effects: TextEffect[]
}


export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: '',
  fontSizePx: 24,
  direction: 'horizontal',
  align: 'start',
  color: '#000000',
  leadingPercent: 120,
  effects: [],
}
