import { ref } from 'vue'
import type { LayerEffect } from '@shared/effects/types'
import { faceTree } from '@shared/page/trees'
import { blocksOnSide, shownCodeOf } from '@shared/page/units'
import type { TextSide } from '@shared/page/text'
import type { TextStyle } from '@shared/text-style/types'
import type { Sample } from '@/lib/fontSampleCache'
import { drawnLabel, drawnLabelSize, familyIsMissing } from '@/lib/labelRaster'
import type { ShelfAttribute, ShelfBucket } from '@/lib/shelfAttributes'
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

/** One object as the shelf draws it. */
export interface ShelfItem {
  id: string
  pageId: string
  pageNumber: number
  code: string
  style: TextStyle
  effects: readonly LayerEffect[]
  sizePx: number
  /** The bitmap's size in page pixels, measured without drawing it. */
  width: number
  height: number
  missing: boolean
  scale: number
  title: string
  /** What the drawing depends on; a new key is a new drawing. */
  key: string
}

export interface ShelfHeap extends ShelfBucket {
  items: ShelfItem[]
}

/**
 * Each object's piece, kept by id for as long as what it shows is unchanged.
 * Only measured: the shelf lays every piece out but draws only those scrolled
 * into view (`shelfDrawingOf`) — drawing a whole chapter is three hundred
 * milliseconds of four hundred objects, and most of them are below the fold.
 */
const pieces = new Map<string, ShelfItem>()

export function shelfPieceOf(entry: ShelfEntry): ShelfItem {
  const key = JSON.stringify([entry.code, entry.style, entry.effects])
  const held = pieces.get(entry.id)
  if (held?.key === key && held.pageId === entry.pageId && held.pageNumber === entry.pageNumber) return held
  const size = drawnLabelSize(entry.code, entry.style, entry.effects)
  const font = entry.style.fontFamily || '未指定'
  const piece: ShelfItem = {
    id: entry.id,
    pageId: entry.pageId,
    pageNumber: entry.pageNumber,
    code: entry.code,
    style: entry.style,
    effects: entry.effects,
    sizePx: entry.style.fontSizePx,
    width: size?.width ?? 40,
    height: size?.height ?? 20,
    missing: familyIsMissing(entry.style.fontFamily),
    // The square root keeps the order of sizes while pulling a 368px shout
    // and a 47px aside within reach of one column.
    scale: 3.6 / Math.sqrt(entry.style.fontSizePx),
    title: `第 ${entry.pageNumber} 頁 · ${font} ${entry.style.fontStyleName} · ${entry.style.fontSizePx}px`,
    key,
  }
  pieces.set(entry.id, piece)
  return piece
}

/**
 * A piece's drawing, kept by id and key for as long as the shelf lists it, and
 * kept here rather than in the shelf so switching tabs away and back does not
 * draw it again: a chapter holds more objects than the sample cache does (240).
 */
const drawings = new Map<string, { key: string; sample: Sample | null }>()

export function shelfDrawingOf(item: ShelfItem): Sample | null {
  const held = drawings.get(item.id)
  if (held?.key === item.key) return held.sample
  // Upright: the shelf compares how pieces are set, not how they lie.
  const { sample } = drawnLabel(item.code, item.style, item.effects, { x: 0, y: 0 }, 0)
  drawings.set(item.id, { key: item.key, sample })
  return sample
}

/** Lets go of the pieces and drawings of objects the shelf no longer lists. */
export function forgetShelfPiecesExcept(kept: readonly ShelfItem[]): void {
  if (pieces.size === kept.length && drawings.size <= kept.length) return
  const ids = new Set(kept.map((p) => p.id))
  for (const id of pieces.keys()) if (!ids.has(id)) pieces.delete(id)
  for (const id of drawings.keys()) if (!ids.has(id)) drawings.delete(id)
}

export function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i])
}

export function sameHeaps(a: readonly ShelfHeap[], b: readonly ShelfHeap[]): boolean {
  return (
    a.length === b.length &&
    a.every((heap, i) => {
      const other = b[i]!
      return heap.key === other.key && heap.label === other.label && heap.swatch === other.swatch && sameItems(heap.items, other.items)
    })
  )
}
