import type { ManifestJson, TranslationUnit } from '@shared/page/types'
import { joinPieces, projectionCodeOf, unitsInReadingOrder } from '@shared/page/units'
import { escapeText } from '@shared/page/markup'
import type { PageTexts, TranslationTexts } from '@shared/mcp/types'
import type { ProjectFile } from '@/types/project'

/**
 * ⚠️ The markup, not what it reads as. An agent that was shown the plain words
 * would send them back without the tags around them, and the person's sizing
 * and colouring of that line would be gone the moment it was picked.
 */
export function textsOfUnit(page: ManifestJson, unit: TranslationUnit): TranslationTexts {
  const source = projectionCodeOf(page.layers, unit, 'source')
  const separators = unit.translation.separators.map(escapeText)
  return {
    id: unit.id,
    source: source.length === 0 ? null : source,
    translation: projectionCodeOf(page.layers, unit, 'translation'),
    blocks: unit.translation.members.length,
    candidates: unit.candidates.map((c) => ({
      id: c.id,
      text: joinPieces(c.pieces, separators),
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
