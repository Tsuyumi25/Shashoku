import type { ManifestJson, TranslationUnit } from '@shared/page/types'
import { joinPieces, projectionOf, unitsInReadingOrder } from '@shared/page/units'
import type { PageTexts, TranslationTexts } from '@shared/mcp/types'
import type { ProjectFile } from '@/types/project'

export function textsOfUnit(page: ManifestJson, unit: TranslationUnit): TranslationTexts {
  const source = projectionOf(page.layers, unit, 'source')
  return {
    id: unit.id,
    source: source.length === 0 ? null : source,
    translation: projectionOf(page.layers, unit, 'translation'),
    blocks: unit.translation.members.length,
    candidates: unit.candidates.map((c) => ({
      id: c.id,
      text: joinPieces(c.pieces, unit.translation.separators),
      human: c.human === true,
      chosen: unit.chosen === c.id,
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
      objects: unitsInReadingOrder(file.page).map((unit) => textsOfUnit(file.page, unit)),
    }
  })
}
