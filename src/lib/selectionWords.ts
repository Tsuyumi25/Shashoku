import type { TextLayerEntry } from '@shared/page/types'

/** One selected text object, with what a preview needs to know about where it sits. */
export interface WordsPiece {
  entry: TextLayerEntry
  /** The translation it belongs to, or nothing when the page does not say. */
  sentence: string | null
  /** Its place among that translation's pieces. */
  at: number
  /** What it says, line by line. */
  lines: readonly string[]
}

/**
 * What a selection says, for a preview to be drawn with. The pieces of one
 * translation run together in their own order — together they are one
 * sentence, and whatever is previewed lands on all of them — while separate
 * translations each start a line.
 */
export function selectionWords(pieces: readonly WordsPiece[]): string {
  const sentences = new Map<string, WordsPiece[]>()
  for (const piece of pieces) {
    const key = piece.sentence ?? `object:${piece.entry.id}`
    const held = sentences.get(key)
    if (held) held.push(piece)
    else sentences.set(key, [piece])
  }
  return [...sentences.values()]
    .map((held) =>
      [...held]
        .sort((a, b) => a.at - b.at)
        .map((p) => p.lines.join('\n'))
        .join(''),
    )
    .join('\n')
}
