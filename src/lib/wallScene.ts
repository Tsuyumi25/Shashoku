import { blocksOnSide, shownCodeOf, unitOfBlock } from '@shared/page/units'
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
): WallScene {
  const entries: WallEntry[] = []
  files.forEach((file, i) => {
    if (file.badge !== 'ok') return
    for (const block of blocksOnSide(file.page.layers, 'translation')) {
      entries.push({
        id: block.id,
        pageId: file.pageId,
        pageNumber: i + 1,
        code: shownCodeOf(file.page, block),
        style: { ...block.body.style },
        effects: JSON.parse(JSON.stringify(block.effects)),
        tags: [...(unitOfBlock(file.page, block.id)?.tags ?? [])],
      })
    }
  })
  return { entries, registry: JSON.parse(JSON.stringify(registry)), currentPageId }
}
