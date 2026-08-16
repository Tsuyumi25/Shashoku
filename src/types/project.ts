import type { TextStyle } from '@shared/text-style/types'
import type { TagDefinition } from '@shared/tags/types'
import type { ManifestJson, OcrJson } from '@shared/page/types'
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

  /**
   * What has been read off this page's artwork, in its own file beside the
   * manifest.
   *
   * Apart from the manifest because the two are written for different reasons:
   * a reading changes when a model is run, the document changes when a person
   * works. Loaded and saved with the page all the same — text objects point
   * into this, so a page that opened without it would open with its sources
   * gone.
   */
  ocr: OcrJson

  pageDir: string

  badge: PageBadge
}

export interface ProjectHeader {

  tags: TagDefinition[]

  seedStyle: TextStyle
  comment: string
}
