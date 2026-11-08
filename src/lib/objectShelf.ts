import { ref } from 'vue'
import type { LayerEffect } from '@shared/effects/types'
import { faceTree } from '@shared/page/trees'
import { blocksOnSide, shownCodeOf } from '@shared/page/units'
import type { TextSide } from '@shared/page/text'
import type { TextStyle } from '@shared/text-style/types'
import type { ShelfAttribute } from '@/lib/shelfAttributes'
import type { ProjectFile } from '@/types/project'

/**
 * The one arrangement the chapter's objects are gathered by on the shelf. Held
 * outside the component so switching away from the tab and back comes back to
 * the heap that was being read; the face to begin with, which is nearly all it
 * is asked for.
 */
export const shelfAttribute = ref<ShelfAttribute>('font')

export interface ShelfEntry {
  id: string
  pageId: string
  pageNumber: number
  code: string
  style: TextStyle
  effects: readonly LayerEffect[]
}

/**
 * Every text object of one side in the chapter, read in place rather than
 * copied out — this is rebuilt whenever any object changes, a tried-on look
 * included, and copying the whole chapter each time is most of a frame.
 */
export function shelfEntriesOf(files: readonly ProjectFile[], side: TextSide, face: string): ShelfEntry[] {
  const entries: ShelfEntry[] = []
  files.forEach((file, i) => {
    if (file.badge !== 'ok') return
    const layers = side === 'source' ? file.page.pageTree : faceTree(file.page, face)
    for (const block of blocksOnSide(layers, side, face)) {
      const code = shownCodeOf(block)
      if (!code.trim()) continue
      entries.push({
        id: block.id,
        pageId: file.pageId,
        pageNumber: i + 1,
        code,
        style: block.body.style,
        effects: block.effects,
      })
    }
  })
  return entries
}
