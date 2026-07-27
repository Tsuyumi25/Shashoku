










import type { ExportProfile } from '../export/types'
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
  /**
   * How this project gets delivered. Kept here rather than in preferences and
   * inheriting from nothing: a project handed to someone else has to arrive
   * knowing how it is meant to come out.
   */
  exportProfiles: ExportProfile[]
}
