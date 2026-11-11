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
import { flipOf, signsOf, type Flip } from '@/lib/flip'
import { textProjection } from '@/lib/textProjection'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'

/** Where the caret before plain character `index` stands on the page. */
function caretOnPage(
  code: string,
  style: TextStyle,
  effects: readonly LayerEffect[],
  at: Anchor,
  rotation: number,
  flip: Flip,
  index: number,
): Anchor {
  const { sample, box, center } = drawnLabel(code, style, effects, at, rotation, flip)
  const vertical = style.direction === 'vertical'
  const projection = textProjection({
    text: plainOf(code),
    clusters: sample?.clusters ?? [],
    vertical,
    padding: sample?.padding ?? samplePadding(engineStrokeFor(effects), style.weightPx),
    crossExtent: vertical ? box.w : box.h,
  })
  const r = projection.caret(index)
  // The bitmap is mirrored about its own middle where it lands, and the caret with it.
  const sign = signsOf(flip)
  const out = turnedAround({ x: 0, y: 0 }, { x: sign.x * (r.x - box.w / 2), y: sign.y * (r.y - box.h / 2) }, rotation)
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
 * The pieces stay in the same sentence, each directly after the one before, so
 * the sentence reads in the same order, and each piece starts where its first
 * character was drawn. Nothing moves on the page until the new block is
 * dragged. The first piece stays in the block, wherever what it reads as lives;
 * the others are their own words in blocks with no proposals of their own.
 */
export function useCutText() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const notices = useNoticeStore()

  function cutSelection(pageId: string, blockId: string, start: number, end: number): void {
    const file = project.pageById(pageId)
    const block = project.blockById(pageId, blockId)
    const place = project.placeOf(pageId, blockId)
    const path = file ? pathOf(editor.workingTree(pageId), blockId) : null
    if (!file || !block || !place || path === null) return

    const code = shownCodeOf(block)
    const text = plainOf(code)
    const cut = cutText(text, start, end)
    if (cut === null) {
      notices.say('選一段字再剪，整段選起來就沒有東西可以剪')
      return
    }

    const codePieces = codeOfPieces(code, text.length, cut)
    const { style, x, y, rotation } = block.body
    const flip = flipOf(block.body)
    const copies: TextLayerEntry[] = codePieces.slice(1).map((piece, i) => {
      const want = caretOnPage(code, style, block.effects, { x, y }, rotation, flip, cut.offsets[i + 1]!)
      const has = caretOnPage(piece, style, block.effects, { x, y }, rotation, flip, 0)
      const placed = {
        lines: linesOf(piece),
        style: { ...style },
        x: x + want.x - has.x,
        y: y + want.y - has.y,
        rotation,
      }
      const id = generateId()
      const effects = cloneEffects(block.effects)
      return block.side === 'source'
        ? { ...block, id, effects, body: { ...block.body, ...placed, tags: [...block.body.tags] } }
        : { ...block, id, effects, body: { ...block.body, ...placed, candidates: [], chosen: null } }
    })

    // Each piece directly above the one before it, as a copy lands.
    const above = (i: number) => [...path.slice(0, -1), path[path.length - 1]! + 1 + i]

    const home = editor.layerHome()
    editor.cmdReshape(`cut-text ${blockId}`, pageId, () => {
      copies.forEach((copy, i) => {
        project.addLayer(pageId, home, copy, above(i))
        project.addMemberAfter(pageId, i === 0 ? blockId : copies[i - 1]!.id, copy.id)
      })
      project.updateLabelText(pageId, blockId, codePieces[0]!)
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
