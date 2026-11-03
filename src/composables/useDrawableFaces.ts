import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import type { FontEntry } from '@shared/fonts/types'
import { coverageFor } from '@/lib/fontSampleCache'

/** How long one frame may spend asking faces for their coverage, in milliseconds. */
const FRAME_BUDGET_MS = 8

/** An unreadable face keeps its place rather than vanishing for a reason nobody can see. */
export function drawsText(entry: FontEntry, text: string): boolean {
  try {
    return coverageFor(entry, text).length === 0
  } catch {
    return true
  }
}

/**
 * The faces that can draw the text, asked a slice of each frame. Coverage is
 * engine work on the renderer's own thread, and a whole catalogue asked at once
 * is a freeze on every change of the text — which a selection is.
 *
 * ⭐ Until a pass finishes, the last finished one stands: a list that hides
 * faces a moment late is better than a click that waits for it. Null before
 * any pass has finished, and while off.
 */
export function useDrawableFaces(
  entries: () => readonly FontEntry[],
  text: () => string,
  on: () => boolean,
  draws: (entry: FontEntry, text: string) => boolean = drawsText,
): Readonly<Ref<ReadonlySet<FontEntry> | null>> {
  const drawable = shallowRef<ReadonlySet<FontEntry> | null>(null)
  let frame: number | null = null
  const stop = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }

  watch(
    [entries, text, on],
    ([list, words, wanted]) => {
      stop()
      if (!wanted) {
        drawable.value = null
        return
      }
      const found = new Set<FontEntry>()
      let i = 0
      const step = () => {
        frame = null
        const until = performance.now() + FRAME_BUDGET_MS
        while (i < list.length && performance.now() < until) {
          if (draws(list[i]!, words)) found.add(list[i]!)
          i++
        }
        if (i < list.length) frame = requestAnimationFrame(step)
        else drawable.value = found
      }
      step()
    },
    { immediate: true },
  )
  onScopeDispose(stop)
  return drawable
}
