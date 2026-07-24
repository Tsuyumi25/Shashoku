





import type { TextStyle } from '../text-style/types'

export interface SskLabel {
  
  id: string
  
  x: number
  
  y: number
  
  groupId: string | null
  
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
