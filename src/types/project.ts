import type { TextStyle } from '@shared/text-style/types'
import type { TagDefinition } from '@shared/tags/types'
import type { ManifestJson } from '@shared/page/types'
import type { PageBadge } from '@shared/ipc/channels'

export interface ProjectFile {
  /**
   * What names this page for as long as it exists. Everything that has to say
   * which page it means — a dirty flag, the cursor, a command's undo — holds
   * this, so it has to stay put even as the page is renamed or reordered.
   */
  pageId: string

  /** The page document itself — the tree, the reading order, the text. */
  page: ManifestJson

  pageDir: string

  badge: PageBadge
}

export interface ProjectHeader {

  tags: TagDefinition[]

  seedStyle: TextStyle
  comment: string
}
