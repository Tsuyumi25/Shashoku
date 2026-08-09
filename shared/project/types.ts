










import type { ExportProfile } from '../export/types'
import type { TagDefinition } from '../tags/types'
import type { TextStyle } from '../text-style/types'

export const PROJECT_SCHEMA_VERSION = 4


export type Glossary = Record<string, string>


export interface ProjectJson {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION

  /**
   * The pages of this chapter, by directory name, in the order they are read.
   *
   * Order only. Whether a page exists is answered by the disk, so a name here
   * with no directory behind it is a fault to show rather than a page, and a
   * directory nobody listed joins the end instead of being ignored.
   */
  pages: string[]

  /**
   * Every tag this project has been told about, in the order the user put them.
   * Position is priority: an object carrying several of these draws in the
   * colour of whichever sits highest.
   *
   * Advisory only — see `TagDefinition`. Removing an entry takes away a colour,
   * not the tag itself.
   */
  tags: TagDefinition[]

  /**
   * What a new text object starts out looking like. A seed, not a default: once
   * an object exists it carries its own complete style, and changing this never
   * reaches back to anything already placed.
   */
  seedStyle: TextStyle

  comment: string
  
  glossary?: Glossary
  /**
   * How this project gets delivered. Kept here rather than in preferences and
   * inheriting from nothing: a project handed to someone else has to arrive
   * knowing how it is meant to come out.
   */
  exportProfiles: ExportProfile[]
}
