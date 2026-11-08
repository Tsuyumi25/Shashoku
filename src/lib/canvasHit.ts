import type { Anchor } from '@/lib/coords'

type ObjectAt = (p: Anchor) => string | null

let probe: ObjectAt | null = null

/**
 * The canvas's own answer to which object a page point is on, for a drag from
 * outside it. Asking the DOM instead misses whenever the frames are not taking
 * the pointer — under a selection tool, or with a gesture armed.
 */
export function provideObjectAt(fn: ObjectAt): () => void {
  probe = fn
  return () => {
    if (probe === fn) probe = null
  }
}

export function objectAtPage(p: Anchor): string | null {
  return probe?.(p) ?? null
}
