





import type { TextStyle } from '../text-style/types'

export interface SskLabel {
  
  id: string
  
  x: number
  
  y: number
  
  groupId: string | null

  /**
   * The object's own turn on the page, in radians, clockwise. Absent means
   * upright, which is what nearly every label is — writing it out would put a
   * zero on every line of every page for the sake of the few that are turned.
   */
  rotation?: number

  lines: string[]
  
  styleOverride?: Partial<TextStyle>
}

export type DocTemplateMode = 'auto' | 'none' | 'custom'
export type TextDirectionMode = 'keep' | 'horizontal' | 'vertical'
export type OutputFormat = 'psd' | 'tiff' | 'png' | 'jpg'

export interface SskExportConfig {
  docTemplate: DocTemplateMode
  
  docTemplateFilename: string | null
  outputFormat: OutputFormat
  ignoreNoLabelImages: boolean
  
  createLayerGroups: boolean
  
  font: string | null
  
  fontSizePx: number | null
  
  textColor: string
  
  textLeadingPercent: number | null
  textDirection: TextDirectionMode
  
  outputLabelIndex: boolean
  
  actionSetName: string | null
  
  outputFolderName: string | null
  
  exportGroups: string[] | null
}
