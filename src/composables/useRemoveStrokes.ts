import { computed, shallowRef } from 'vue'
import type { RasterLayerEntry } from '@shared/page/types'
import { useInpaint } from '@/composables/useInpaint'
import type { Rect } from '@/lib/selection/rect'
import { coverageWithin, type StrokeSurface } from '@/lib/selection/strokeSurface'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useStrokeOverlayStore } from '@/stores/strokeOverlayStore'

/** What the remove brush has painted and not yet handed to the model. */
export interface PendingRemoval {
  page: string
  entry: RasterLayerEntry
  surface: StrokeSurface
  dirty: Rect
  /** The overlay claim that shows it, held across every stroke until it goes. */
  shown: number
}

const pending = shallowRef<PendingRemoval | null>(null)

/**
 * The remove brush's area between strokes: repaired as each stroke lets go, or
 * gathered until Enter when that is switched off.
 */
export function useRemoveStrokes() {
  const overlay = useStrokeOverlayStore()
  const preferences = usePreferencesStore()
  const inpaint = useInpaint()

  const hasPending = computed(() => pending.value !== null)

  /**
   * The area a new stroke on `page` and `entry` adds to, taken out so nothing
   * repairs it under the hand. An area left on another page or layer is let go.
   */
  function resume(page: string, entry: RasterLayerEntry): PendingRemoval | null {
    const was = pending.value
    if (was === null) return null
    if (was.page !== page || was.entry.id !== entry.id) {
      discard()
      return null
    }
    pending.value = null
    return was
  }

  function hold(area: PendingRemoval): void {
    pending.value = area
    if (preferences.prefs.removeEachStroke) void commit()
  }

  async function commit(): Promise<void> {
    const area = pending.value
    if (area === null || inpaint.working.value) return
    pending.value = null
    try {
      await inpaint.eraseCovered(area.page, area.entry, area.dirty, (at) => coverageWithin(area.surface, at))
    } finally {
      overlay.end(area.shown)
    }
  }

  function discard(): void {
    const area = pending.value
    if (area === null) return
    pending.value = null
    overlay.end(area.shown)
  }

  return { hasPending, working: inpaint.working, resume, hold, commit, discard }
}
