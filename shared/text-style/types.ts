











export type TextDirection = 'horizontal' | 'vertical'


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
  
  color: string
  
  leadingPercent: number

  effects: TextEffect[]
}


export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: '',
  fontSizePx: 24,
  direction: 'horizontal',
  color: '#000000',
  leadingPercent: 120,
  effects: [],
}
