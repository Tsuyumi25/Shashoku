import { computed, ref, watch, type Ref, type ShallowRef } from 'vue'
import { createTextEditSurface } from '@/composables/useTextEditSurface'

/** What a font sample says before anything is selected or typed. */
export const DEFAULT_SAMPLE_TEXT = '等一下……你是說真的嗎！？\n等一下……你是说真的吗！？'

/**
 * Typing into a grid of font samples that all show one string.
 *
 * The control the sample is typed into is never seen: the letters the user is
 * looking at are the engine's, drawn in the cell, and this only holds the
 * keyboard and gives the IME somewhere to open its candidates (ADR 0001,
 * decision 4).
 */
export function useSampleTyping(
  sampleText: Ref<string>,
  sampleEl: Readonly<ShallowRef<HTMLTextAreaElement | null>>,
) {
  const surface = createTextEditSurface()
  const { range, moved } = surface

  watch(sampleEl, (el) => surface.register(el), { immediate: true })

  /**
   * Which cell is being typed into, or null.
   *
   * One at a time, because there is one sample string. Held as the family rather
   * than the row, so a scroll that recycles the virtual rows leaves the caret on
   * the cell it belongs to.
   */
  const aimedAt = ref<string | null>(null)

  function aim(family: string): void {
    if (aimedAt.value !== family) {
      aimedAt.value = family
      surface.pin(true)
    }
    // Guarded, because a drag asks for this on every frame and taking focus that
    // is already held is work for nothing.
    const el = sampleEl.value
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
  }

  /** A press on the cell but outside the sample: take the cell, leave the caret. */
  function aimCell(family: string, e: MouseEvent) {
    // A cell cannot hold focus itself, so letting the press run its course would
    // clear the focus the control is being given within the same click.
    e.preventDefault()
    aim(family)
  }

  function onCellSelect(family: string, anchor: number, focus: number) {
    aim(family)
    surface.setRange(anchor, focus)
  }

  const words = new Intl.Segmenter(undefined, { granularity: 'word' })

  function onCellWord(family: string, at: number) {
    aim(family)
    for (const piece of words.segment(sampleText.value)) {
      const end = piece.index + piece.segment.length
      if (at >= piece.index && at < end) {
        surface.setRange(piece.index, end)
        return
      }
    }
  }

  function onSampleInput(e: Event) {
    sampleText.value = (e.target as HTMLTextAreaElement).value
  }

  /**
   * A new selection replaces the text under the caret without an `input` event to say
   * so, so the control's own selection is what the projection has to be told
   * about — the browser has already clamped it by the time this runs.
   */
  watch(sampleText, () => surface.read(), { flush: 'post' })

  function onSampleBlur() {
    aimedAt.value = null
    surface.pin(false)
    surface.showCaretAt(null)
  }

  /**
   * Parked when no cell is aimed. It is never focused then, so it cannot pull the
   * window's scroll — which is the one thing an off-screen focused element does.
   */
  const PARKED = {
    position: 'fixed' as const,
    left: '0px',
    top: '0px',
    width: '1px',
    height: '1px',
  }

  const sampleStyle = computed(() => {
    const box = surface.pinnedBox.value
    if (box === null) return PARKED
    return {
      position: 'fixed' as const,
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      writingMode: box.vertical ? ('vertical-rl' as const) : ('horizontal-tb' as const),
    }
  })

  return {
    aimedAt,
    sampleRange: range,
    sampleCaretKey: moved,
    sampleStyle,
    aimCell,
    onCellSelect,
    onCellWord,
    onSampleInput,
    onSampleBlur,
    showCaretAt: surface.showCaretAt,
  }
}
