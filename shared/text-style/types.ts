











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


/**
 * Which batch operation last wrote each field, by the label that operation
 * showed the user. A field nobody has batched — or one edited by hand since —
 * is absent, which is how a hand edit says "this one is mine now".
 *
 * The label is stored rather than an id pointing at an operation log: the log
 * would need a lifetime of its own (kept after an undo? after a reopen?), and
 * every question it raises is one this field exists to avoid. A person reading
 * the manifest can also see what happened without a second file to join against.
 */
export type TextStyleProvenance = Partial<Record<keyof TextStyle, string>>


export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: '',
  fontSizePx: 24,
  direction: 'horizontal',
  align: 'start',
  color: '#000000',
  leadingPercent: 120,
  effects: [],
}
