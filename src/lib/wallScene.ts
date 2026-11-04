import { blocksOnSide, facePage, shownCodeOf, tagsOfBlock } from '@shared/page/units'
import { faceTree } from '@shared/page/trees'
import type { TagRegistry } from '@shared/tags/types'
import type { WallEntry, WallScene } from '@shared/wall/scene'
import type { ProjectFile } from '@/types/project'

/**
 * The chapter as the wall draws it. Plain data throughout — copied out of the
 * project rather than pointing into it — so the same scene can be drawn here
 * or handed to another window.
 */
export function wallSceneOf(
  files: readonly ProjectFile[],
  registry: TagRegistry,
  currentPageId: string | null,
  face: string,
): WallScene {
  const entries: WallEntry[] = []
  files.forEach((file, i) => {
    if (file.badge !== 'ok') return
    const page = facePage(file.page, face)
    for (const block of [
      ...blocksOnSide(faceTree(file.page, face), 'translation', face),
      ...blocksOnSide(file.page.pageTree, 'source', face),
    ]) {
      entries.push({
        id: block.id,
        side: block.side,
        pageId: file.pageId,
        pageNumber: i + 1,
        code: shownCodeOf(block),
        style: { ...block.body.style },
        effects: JSON.parse(JSON.stringify(block.effects)),
        tags: tagsOfBlock(page, block.id),
      })
    }
  })
  return { entries, registry: JSON.parse(JSON.stringify(registry)), currentPageId }
}
