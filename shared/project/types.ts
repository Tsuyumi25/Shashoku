










import type { SskExportConfig } from '../ssk/types'
import type { TextStyle } from '../text-style/types'

export const PROJECT_SCHEMA_VERSION = 2


export type Glossary = Record<string, string>


export interface StyleGroup {
  id: string
  name: string
  color: string
  style: TextStyle
}


export interface ProjectJson {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  
  groups: StyleGroup[]
  
  defaultStyle: TextStyle
  
  comment: string
  
  glossary?: Glossary
  exportConfig: SskExportConfig
}
