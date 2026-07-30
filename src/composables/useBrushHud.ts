import { ref } from 'vue'
import { hudBrushHardness, hudBrushSize } from '@/lib/selection/brushHud'
import type { MaskBrushMode } from '@/lib/selection/brushMask'
import { useSelectionStore } from '@/stores/selectionStore'

interface HudGesture {
  mode: MaskBrushMode
  /** Where the drag began, in the canvas's own box. */
  sx: number
  sy: number
  /** What the brush was before the drag, so Escape has something to put back. */
  size: number
  hardness: number
}

/**
 * Sizing the brush by dragging on the page, where the brush is, instead of
 * reaching for a field somewhere else.
 *
 * The brush is written to as the drag goes rather than at the end, so what is
 * drawn on the page is the live brush and not a preview of one — there is only
 * ever one thing to keep in step.
 */
export function useBrushHud() {
  const selection = useSelectionStore()
  const gesture = ref<HudGesture | null>(null)

  function begin(mode: MaskBrushMode, sx: number, sy: number): void {
    const settings = selection.brushes[mode]
    gesture.value = { mode, sx, sy, size: settings.size, hardness: settings.hardness }
  }

  function trackTo(x: number, y: number): void {
    const g = gesture.value
    if (g === null) return
    const settings = selection.brushes[g.mode]
    settings.size = hudBrushSize(g.size, x - g.sx)
    settings.hardness = hudBrushHardness(g.hardness, y - g.sy)
  }

  /** Letting go keeps whatever the drag arrived at. */
  function commit(): void {
    gesture.value = null
  }

  /** Escape puts back what the drag started from. */
  function cancel(): void {
    const g = gesture.value
    if (g === null) return
    const settings = selection.brushes[g.mode]
    settings.size = g.size
    settings.hardness = g.hardness
    gesture.value = null
  }

  return { gesture, begin, trackTo, commit, cancel }
}
