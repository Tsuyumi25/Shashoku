import type {
  ManifestJson,
  TranslationCandidate,
  TranslationTextLayerEntry,
  TranslationUnit,
} from '@shared/page/types'
import {
  facePage,
  projectionCodeOf,
  shownCodeOf,
  sourceBlocksOf,
  translationBlocksOf,
  tagsOfUnit,
  unitsAlongLines,
  type FacePage,
} from '@shared/page/units'
import { letterOf } from '@shared/page/numbers'
import type { TranslationFace } from '@shared/project/types'
import type {
  FaceTexts,
  PageTexts,
  SentenceTexts,
  TranslationCandidateView,
} from '@shared/mcp/types'
import { formatRef, type TextRef } from '@shared/mcp/refs'
import type { ProjectFile } from '@/types/project'

function drawerOf(block: TranslationTextLayerEntry): TranslationCandidateView[] {
  return block.body.candidates.map((c) => ({
    id: c.id,
    letter: letterOf(c.no!),
    text: c.lines.join('\n'),
    human: c.human === true,
    chosen: block.body.chosen === c.id,
    ...(c.source ? { source: c.source } : {}),
  }))
}

/**
 * Where a block is written down. A sentence set in one block answers to the
 * sentence's own number too, which is what most pages are.
 */
function refsOfBlock(
  pageId: string,
  unit: TranslationUnit,
  block: TranslationTextLayerEntry,
  sole: boolean,
): string[] {
  const explicit = formatRef({ pageId, sentence: unit.no!, block: block.no! })
  return sole ? [formatRef({ pageId, sentence: unit.no! }), explicit] : [explicit]
}

/**
 * ⚠️ The markup, not what it reads as. An agent that was shown the plain words
 * would send them back without the tags around them, and the person's sizing
 * and colouring of that line would be gone the moment it was picked.
 */
export function textsOfUnit(pageId: string, page: FacePage, unit: TranslationUnit): SentenceTexts {
  const blocks = translationBlocksOf(page, unit)
  return {
    id: unit.id,
    no: unit.no!,
    sources: sourceBlocksOf(page, unit).map((b) => ({ no: b.no!, text: shownCodeOf(b) })),
    translation: projectionCodeOf(page, unit, 'translation'),
    blocks: blocks.map((block) => ({
      id: block.id,
      no: block.no!,
      refs: refsOfBlock(pageId, unit, block, blocks.length === 1),
      text: shownCodeOf(block),
      candidates: drawerOf(block),
    })),
    tags: tagsOfUnit(page, unit),
  }
}

export function textsOfFace(
  pageId: string,
  manifest: ManifestJson,
  face: TranslationFace,
): FaceTexts {
  const page = facePage(manifest, face.id)
  const rows = unitsAlongLines(page)
  const noOf = new Map(rows.map((row) => [row.id, row.unit.no!]))
  return {
    faceId: face.id,
    faceNo: face.no,
    name: face.name,
    sentences: rows.map((row) => textsOfUnit(pageId, page, row.unit)),
    edges: rows.flatMap((row) => row.parents.map((from) => ({ from: noOf.get(from)!, to: row.unit.no! }))),
  }
}

/**
 * Every page, or only those named, in the project's order either way — and
 * every face, or only the one named. `no` is the page's place in the whole
 * chapter, so asking for three pages does not renumber them.
 */
export function collectTexts(
  files: readonly ProjectFile[],
  faces: readonly TranslationFace[],
  pageIds?: readonly string[],
  faceId?: string,
): PageTexts[] {
  const wanted = pageIds === undefined ? null : new Set(pageIds)
  const listed = faceId === undefined ? faces : faces.filter((f) => f.id === faceId)
  const out: PageTexts[] = []
  files.forEach((file, index) => {
    if (wanted !== null && !wanted.has(file.pageId)) return
    const head = { pageId: file.pageId, no: index + 1, name: file.page.name, badge: file.badge }
    out.push({
      ...head,
      faces: file.badge === 'ok' ? listed.map((f) => textsOfFace(file.pageId, file.page, f)) : [],
    })
  })
  return out
}

/** Where a write landed: the face that reads it, the sentence, and the block it names. */
export interface RefPlace {
  pageId: string
  page: FacePage
  face: string
  unit: TranslationUnit
  block: TranslationTextLayerEntry
  candidate?: TranslationCandidate
  /** This block's address as it is written back — the sentence's own where it has one block. */
  blockRef: string
}

export type RefLookup = { place: RefPlace } | { refusal: string }

/**
 * What an address names in one face.
 *
 * A sentence standing for its block is the ordinary case and the only one an
 * agent can write without reading the blocks first; a sentence set in several
 * is refused rather than guessed at, since nothing in the number says which of
 * them the words were written for.
 */
export function resolveRef(
  manifest: ManifestJson,
  pageId: string,
  face: TranslationFace,
  ref: TextRef,
): RefLookup {
  const page = facePage(manifest, face.id)
  const unit = page.units.find((u) => u.no === ref.sentence)
  if (unit === undefined) {
    return { refusal: `${pageId} 的 f${face.no} 沒有第 ${ref.sentence} 句` }
  }
  const blocks = translationBlocksOf(page, unit)
  const sentenceRef = formatRef({ pageId, sentence: ref.sentence })
  if (blocks.length === 0) {
    return { refusal: `${sentenceRef} 在 f${face.no} 還沒有譯文方塊` }
  }
  const spelt = blocks.map((b) => formatRef({ pageId, sentence: ref.sentence, block: b.no! }))
  let block: TranslationTextLayerEntry | undefined
  if (ref.block === undefined) {
    if (blocks.length > 1) {
      return {
        refusal: `${sentenceRef} 的譯文分成 ${blocks.length} 塊——請指定是哪一塊：${spelt.join('、')}`,
      }
    }
    block = blocks[0]
  } else {
    block = blocks.find((b) => b.no === ref.block)
    if (block === undefined) {
      return { refusal: `${sentenceRef} 沒有第 ${ref.block} 塊——它有 ${spelt.join('、')}` }
    }
  }
  const blockRef = refsOfBlock(pageId, unit, block, blocks.length === 1)[0]
  const place: RefPlace = { pageId, page, face: face.id, unit, block, blockRef }
  if (ref.candidate === undefined) return { place }
  const candidate = block.body.candidates.find((c) => c.no === ref.candidate)
  if (candidate === undefined) {
    const letters = block.body.candidates.map((c) => letterOf(c.no!))
    const had = letters.length === 0 ? '抽屜是空的' : `現有 ${letters.join('、')}`
    return { refusal: `${blockRef} 的抽屜裡沒有 ${letterOf(ref.candidate)}——${had}` }
  }
  return { place: { ...place, candidate } }
}

export interface Address {
  ref: string
  faceId: string
  faceNo: number
}

/**
 * Where an object this session was shown under some address lives now, so a
 * write quoting the old one can be answered with the new one instead of just
 * being told no.
 */
export function addressOf(
  files: readonly ProjectFile[],
  faces: readonly TranslationFace[],
  id: string,
): Address | null {
  for (const file of files) {
    if (file.badge !== 'ok') continue
    for (const face of faces) {
      const page = facePage(file.page, face.id)
      for (const unit of page.units) {
        const blocks = translationBlocksOf(page, unit)
        for (const block of blocks) {
          const blockRef = refsOfBlock(file.pageId, unit, block, blocks.length === 1)[0]
          if (block.id === id) return { ref: blockRef, faceId: face.id, faceNo: face.no }
          const candidate = block.body.candidates.find((c) => c.id === id)
          if (candidate !== undefined) {
            return { ref: `${blockRef}${letterOf(candidate.no!)}`, faceId: face.id, faceNo: face.no }
          }
        }
      }
    }
  }
  return null
}
