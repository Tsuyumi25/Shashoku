import { textObjectsInReadingOrder } from '@shared/page/tree'
import { textOf } from '@shared/page/text'
import type { TextLayerEntry } from '@shared/page/types'
import type { PageTexts, TextObjectTexts } from '@shared/mcp/types'
import type { ProjectFile } from '@/types/project'

export function textsOfEntry(entry: TextLayerEntry): TextObjectTexts {
  return {
    id: entry.id,
    source: entry.source.lines.join('\n') || null,
    translation: textOf(entry.translation),
    candidates: entry.translation.candidates.map((c) => ({
      id: c.id,
      text: c.lines.join('\n'),
      human: c.human === true,
      chosen: entry.translation.chosen === c.id,
      ...(c.source ? { source: c.source } : {}),
    })),
  }
}

export function collectTexts(files: readonly ProjectFile[]): PageTexts[] {
  return files.map((file) => {
    if (file.badge !== 'ok') return { pageId: file.pageId, badge: file.badge, objects: [] }
    return {
      pageId: file.pageId,
      badge: file.badge,
      objects: textObjectsInReadingOrder(file.page).map(textsOfEntry),
    }
  })
}
