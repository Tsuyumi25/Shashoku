import type { TextLayerEntry } from '@shared/page/types'
import type { TextStyle } from '@shared/text-style/types'
import type { LayerEffect } from '@shared/effects/types'
import { cloneEffects } from '@shared/effects/clone'
import { engineStrokeFor } from '@shared/effects/stroke'
import { generateId } from '@shared/page/schema'
import { linesOf } from '@shared/page/text'
import { pathOf } from '@shared/page/tree'
import { shownCodeOf } from '@shared/page/units'
import { plainOf, splitCode } from '@shared/page/markup'
import { turnedAround, type Anchor } from '@/lib/coords'
import { cutText, type CutText } from '@/lib/cutText'
import { samplePadding } from '@/lib/fontSampleCache'
import { drawnLabel } from '@/lib/labelRaster'
import { textProjection } from '@/lib/textProjection'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore, type RemovedEntry, type SideWords } from '@/stores/projectStore'

/** Where the caret before plain character `index` stands on the page. */
function caretOnPage(
  code: string,
  style: TextStyle,
  effects: readonly LayerEffect[],
  at: Anchor,
  rotation: number,
  index: number,
): Anchor {
  const { sample, box, center } = drawnLabel(code, style, effects, at, rotation)
  const vertical = style.direction === 'vertical'
  const projection = textProjection({
    text: plainOf(code),
    clusters: sample?.clusters ?? [],
    vertical,
    padding: sample?.padding ?? samplePadding(engineStrokeFor(effects), style.weightPx),
    crossExtent: vertical ? box.w : box.h,
  })
  const r = projection.caret(index)
  const out = turnedAround({ x: 0, y: 0 }, { x: r.x - box.w / 2, y: r.y - box.h / 2 }, rotation)
  return { x: center.x + out.x, y: center.y + out.y }
}

/**
 * Each piece of a cut as the markup it was cut from.
 *
 * ⚠️ The cut is made on what the person sees, so its offsets count plain
 * characters; the words themselves live in the code around them. Splitting
 * there closes every tag still open at a seam and opens it again on the other
 * side, so each piece is set exactly as that stretch was.
 */
function codeOfPieces(code: string, plainLength: number, cut: CutText): string[] {
  const edges = new Set<number>()
  for (const [i, piece] of cut.pieces.entries()) {
    edges.add(cut.offsets[i]!)
    edges.add(cut.offsets[i]! + piece.length)
  }
  const cuts = [...edges].sort((a, b) => a - b).filter((at) => at > 0 && at < plainLength)
  const segments = splitCode(code, cuts)
  const starts = [0, ...cuts]
  return cut.pieces.map((_, i) => segments[starts.indexOf(cut.offsets[i]!)]!)
}

/**
 * Cutting the selected stretch of a block out into a block of its own.
 *
 * The pieces stay in the same translation, in reading order, with whatever
 * stood between them as the seams — so the sentence reads exactly as it did,
 * and each piece starts where its first character was drawn. Nothing moves on
 * the page until the new block is dragged.
 */
export function useCutText() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const notices = useNoticeStore()

  function cutSelection(pageId: string, blockId: string, start: number, end: number): void {
    const file = project.pageById(pageId)
    const block = project.blockById(pageId, blockId)
    const place = project.placeOf(pageId, blockId)
    const path = file ? pathOf(file.page.layers, blockId) : null
    const before = project.sideWordsOf(pageId, blockId)
    if (!file || !block || !place || path === null || !before) return

    const code = shownCodeOf(file.page, block)
    const text = plainOf(code)
    const cut = cutText(text, start, end)
    if (cut === null) {
      notices.say('選一段字再剪，整段選起來就沒有東西可以剪')
      return
    }

    const chosen = before.pieces !== null
    const codePieces = codeOfPieces(code, text.length, cut)
    const pieces = codePieces.map(linesOf)
    const { style, x, y, rotation } = block.body
    const copies: TextLayerEntry[] = codePieces.slice(1).map((piece, i) => {
      const want = caretOnPage(code, style, block.effects, { x, y }, rotation, cut.offsets[i + 1]!)
      const has = caretOnPage(piece, style, block.effects, { x, y }, rotation, 0)
      const body = {
        ...block.body,
        // A chosen proposal holds the words being cut, and the block's own
        // lines are a different translation that stays whole in the first one.
        lines: chosen ? [] : pieces[i + 1]!,
        style: { ...style },
        x: x + want.x - has.x,
        y: y + want.y - has.y,
      }
      const id = generateId()
      return block.side === 'source'
        ? { ...block, id, effects: cloneEffects(block.effects), side: 'source', body: { ...body, by: block.body.by } }
        : { ...block, id, effects: cloneEffects(block.effects), side: 'translation', body }
    })

    const after: SideWords = {
      lines: { ...before.lines, ...(chosen ? {} : { [blockId]: pieces[0]! }) },
      pieces: before.pieces && [
        ...before.pieces.slice(0, place.at),
        ...pieces,
        ...before.pieces.slice(place.at + 1),
      ],
      separators: [
        ...before.separators.slice(0, place.at),
        ...cut.seams,
        ...before.separators.slice(place.at),
      ],
    }
    for (const [i, copy] of copies.entries()) {
      after.lines[copy.id] = chosen ? [] : pieces[i + 1]!
    }

    // Each piece directly above the one before it, as a copy lands.
    const above = (i: number) => [...path.slice(0, -1), path[path.length - 1]! + 1 + i]

    let removed: RemovedEntry[] | null = null
    editor.pushCommand({
      label: `cut-text ${blockId}`,
      do: () => {
        if (removed === null) {
          copies.forEach((copy, i) => {
            project.addLayer(pageId, copy, above(i))
            project.addMemberAfter(pageId, i === 0 ? blockId : copies[i - 1]!.id, copy.id)
          })
        } else {
          for (const entry of removed) project.restoreEntry(entry)
        }
        project.setSideWords(pageId, blockId, after)
      },
      undo: () => {
        removed = [...copies]
          .reverse()
          .flatMap((copy) => project.removeEntry(copy.id) ?? [])
          .reverse()
        project.setSideWords(pageId, blockId, before)
      },
    })
    // The selected stretch is what was picked up, so it is what a drag moves —
    // the first block itself when the selection began at the start.
    const ids = [blockId, ...copies.map((copy) => copy.id)]
    let first = Math.min(start, end)
    while (text[first] === '\n') first += 1
    const picked = cut.offsets.filter((at) => at <= first).length - 1
    editor.selectOnly(ids[Math.max(picked, 0)]!)
  }

  return { cutSelection }
}
