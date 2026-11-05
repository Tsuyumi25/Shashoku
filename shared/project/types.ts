










import type { ExportMenuEntry } from '../export/types'
import type { TagDefinition } from '../tags/types'
import type { TextStyle } from '../text-style/types'

export const PROJECT_SCHEMA_VERSION = 4


export type Glossary = Record<string, string>

/** One language the book is lettered in. The id is what pages store; the name is only shown. */
export interface TranslationFace {
  id: string
  /** Its short name, `f2` in an agent's call, never given to another face. */
  no: number
  name: string
}


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
   * The pages that have been deleted, by directory name. Absent means none.
   *
   * A label stuck on, not a page taken away: the name stays in `pages`, the
   * directory stays on disk, and peeling the label off puts the page back in
   * the place it never left. Nothing here is ever collected — what to do with
   * a page once it carries this is a later interface's to decide.
   *
   * Every name here should also be in `pages`; nothing enforces that, so the
   * parser repairs it instead.
   */
  deletedPages?: string[]

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
   * Layer names the label list's page rows show as controls, in this order.
   * Seeded from the machine's preference the first time the project is opened
   * and the project's own from then on: the book is what knows which of its
   * layers matter, and it has to say the same on whoever's machine it opens.
   * Absent only in a file no open has seeded yet.
   */
  pinnedLayerNames?: string[]
  /**
   * The translation faces this book is lettered in, in the order the interface
   * lists them. Every page has a ledger and lettering for each. Absent only in
   * a file no open has seeded yet; the first open makes one under the default name.
   */
  faces?: TranslationFace[]
  /** Which face the interface works on — the one Shift+S switches to from the source. */
  activeFace?: string
  /** The number the next face added is given. */
  nextFace?: number
  /**
   * Layer names the 修圖 opacity buttons write to. Absent until someone changes
   * it, and read as the name a new page gives its working copy.
   */
  retouchLayerNames?: string[]
  /**
   * How this project gets delivered: the recipes it was given when it was made
   * and the ones it has delivered with since. Kept here rather than in
   * preferences: a project handed to someone else has to arrive knowing how it
   * is meant to come out.
   *
   * Undefined for a project that has never had one, which copies the global
   * menu in when it is opened — the same seed `pinnedLayerNames` takes.
   */
  exportMenu?: ExportMenuEntry[]
}
