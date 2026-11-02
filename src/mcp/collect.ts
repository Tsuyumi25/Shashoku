import type {
  ManifestJson,
  TranslationTextLayerEntry,
  TranslationUnit,
} from '@shared/page/types'
import {
  facePage,
  projectionCodeOf,
  shownCodeOf,
  translationBlocksOf,
  unitsInReadingOrder,
  type FacePage,
} from '@shared/page/units'
import { findTextObject } from '@shared/page/tree'
import type { TranslationFace } from '@shared/project/types'
import type { FaceTexts, PageTexts, SentenceTexts, TranslationCandidateView } from '@shared/mcp/types'
import type { ProjectFile } from '@/types/project'

function drawerOf(block: TranslationTextLayerEntry): TranslationCandidateView[] {
  return block.body.candidates.map((c) => ({
    id: c.id,
    text: c.lines.join('\n'),
    human: c.human === true,
    chosen: block.body.chosen === c.id,
    ...(c.source ? { source: c.source } : {}),
  }))
}

/**
 * ⚠️ The markup, not what it reads as. An agent that was shown the plain words
 * would send them back without the tags around them, and the person's sizing
 * and colouring of that line would be gone the moment it was picked.
 */
export function textsOfUnit(page: FacePage, unit: TranslationUnit): SentenceTexts {
  const source = projectionCodeOf(page, unit, 'source')
  const blocks = translationBlocksOf(page, unit)
  return {
    id: unit.id,
    source: source.length === 0 ? null : source,
    translation: projectionCodeOf(page, unit, 'translation'),
    // One block is addressed by the sentence's own id, so listing it again
    // would be two names for one drawer.
    ...(blocks.length > 1
      ? {
          blocks: blocks.map((block) => ({
            id: block.id,
            text: shownCodeOf(block),
            candidates: drawerOf(block),
          })),
        }
      : {}),
    candidates: blocks.length === 1 ? drawerOf(blocks[0]) : [],
  }
}

export function textsOfFace(manifest: ManifestJson, face: TranslationFace): FaceTexts {
  const page = facePage(manifest, face.id)
  return {
    faceId: face.id,
    name: face.name,
    sentences: unitsInReadingOrder(page).map((unit) => textsOfUnit(page, unit)),
  }
}

/** Every page, or only those named, in the project's order either way. */
export function collectTexts(
  files: readonly ProjectFile[],
  faces: readonly TranslationFace[],
  pageIds?: readonly string[],
): PageTexts[] {
  const wanted = pageIds === undefined ? null : new Set(pageIds)
  return files
    .filter((file) => wanted === null || wanted.has(file.pageId))
    .map((file) => {
      if (file.badge !== 'ok') return { pageId: file.pageId, badge: file.badge, faces: [] }
      return {
        pageId: file.pageId,
        badge: file.badge,
        faces: faces.map((face) => textsOfFace(file.page, face)),
      }
    })
}

/** Where a write landed: the face that reads it, the sentence, and the one block it names. */
export interface ObjectPlace {
  page: FacePage
  face: string
  unit: TranslationUnit
  block: TranslationTextLayerEntry
}

export type ObjectLookup = { place: ObjectPlace } | { refusal: string }

/**
 * What an `object_id` names.
 *
 * A block of lettering says which face it belongs to itself. A sentence id is
 * a face's own, so every ledger is searched for it — and it stands for its
 * block only where it has exactly one: with several, nothing in the id says
 * which of them the words were written for, and guessing would put a
 * translation of the whole sentence into one piece of it.
 */
export function resolveObject(
  manifest: ManifestJson,
  faces: readonly string[],
  objectId: string,
): ObjectLookup {
  const block = findTextObject(manifest.layers, objectId)
  if (block !== undefined) {
    if (block.side === 'source') return { refusal: '這是原文方塊——譯文請提給譯文方塊或句子' }
    const page = facePage(manifest, block.face)
    const unit = page.units.find((u) => u.members.includes(block.id))
    if (unit === undefined) return { refusal: '這一塊不屬於任何句子' }
    return { place: { page, face: block.face, unit, block } }
  }
  for (const face of faces) {
    const page = facePage(manifest, face)
    const unit = page.units.find((u) => u.id === objectId)
    if (unit === undefined) continue
    const blocks = translationBlocksOf(page, unit)
    if (blocks.length === 1) return { place: { page, face, unit, block: blocks[0] } }
    if (blocks.length === 0) return { refusal: '這一句在這個面沒有譯文方塊' }
    return {
      refusal: `這一句的譯文分成 ${blocks.length} 塊——請改用塊 id（get_texts 會列出每一塊的 id）`,
    }
  }
  return { refusal: '這一筆翻譯不存在' }
}
