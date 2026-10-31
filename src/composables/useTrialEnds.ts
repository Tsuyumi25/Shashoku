import { onBeforeUnmount, watch, type Ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useEditorStore } from '@/stores/editorStore'

/**
 * A list that tries its entries on the selection while pointed at has to give
 * the trial back however the pointer came to be elsewhere. The leave event is
 * the usual way out, not the only one: a press outside the list, the window
 * losing focus, the selection moving and the list going away all end it, so
 * nothing tried can be kept by accident.
 */
export function useTrialEnds(root: Readonly<Ref<HTMLElement | null>>, end: () => void): void {
  const editor = useEditorStore()
  useEventListener(
    document,
    'pointerdown',
    (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !root.value?.contains(e.target)) end()
    },
    { capture: true },
  )
  useEventListener(window, 'blur', end)
  watch(() => editor.selectedIds, end)
  onBeforeUnmount(end)
}
