


import type { TextStyle } from '@shared/text-style/types'
import type { StyleGroup } from '@shared/project/types'

export interface LabelItem {
  
  id: string
  
  x: number
  
  y: number
  
  groupId: string | null

  /**
   * The object's own turn on the page, in radians, clockwise. Concrete here
   * where the persisted form leaves it out at zero, so nothing downstream has
   * to keep asking whether an absent turn means upright.
   */
  rotation: number

  text: string
  
  styleOverride?: Partial<TextStyle>
}

export interface ProjectFile {
  filename: string
  labels: LabelItem[]
  
  pageDir: string
  
  badge: 'ok' | 'raw-missing' | 'page-missing' | 'damaged'
}

export interface ProjectHeader {
  
  groups: StyleGroup[]
  
  defaultStyle: TextStyle
  comment: string
}
