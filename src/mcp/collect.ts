import { textObjectsInReadingOrder } from '@shared/page/tree'
import { textOf } from '@shared/page/text'
import type { TextLayerEntry } from '@shared/page/types'
import type { PageTexts } from '@shared/mcp/types'
import type { ProjectFile } from '@/types/project'

function sourceTextOf(entry: TextLayerEntry, readings: ReadonlyMap<string, string>): string | null {
  if (entry.source.hash === null) return null
  if (entry.source.hash === 'own') return entry.ownSource === '' ? null : entry.ownSource
  return readings.get(entry.source.hash) ?? null
}

export function collectTexts(files: readonly ProjectFile[]): PageTexts[] {
  return files.map((file) => {
    if (file.badge !== 'ok') return { pageId: file.pageId, badge: file.badge, objects: [] }
    const readings = new Map(file.ocr.candidates.map((c) => [c.hash, c.text]))
    return {
      pageId: file.pageId,
      badge: file.badge,
      objects: textObjectsInReadingOrder(file.page).map((entry) => ({
        id: entry.id,
        source: sourceTextOf(entry, readings),
        translation: textOf(entry),
      })),
    }
  })
}
