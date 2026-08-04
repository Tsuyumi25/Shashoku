import type { TextStyle } from '@shared/text-style/types'
import type { TagDefinition } from '@shared/tags/types'
import type { ManifestJson } from '@shared/page/types'

export interface ProjectFile {
  filename: string

  /** The page document itself — the tree, the reading order, the text. */
  page: ManifestJson

  pageDir: string

  badge: 'ok' | 'raw-missing' | 'page-missing' | 'damaged'
}

export interface ProjectHeader {

  tags: TagDefinition[]

  seedStyle: TextStyle
  comment: string
}
