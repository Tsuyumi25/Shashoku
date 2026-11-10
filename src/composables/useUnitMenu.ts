import { computed } from 'vue'
import type { MenuItem } from '@/components/CanvasMenu.vue'
import { useEditorStore } from '@/stores/editorStore'

const LINK = 'unit-link'
const DETACH = 'unit-detach'

/**
 * Which unit the selected blocks make, the same two items on the canvas,
 * the shelf, the label list and the layer list. Each is offered only where it
 * would change something. Only joining has a key: taking a block out is rare,
 * and a join that went wrong is taken back with Ctrl+Z.
 */
export function useUnitMenu() {
  const editor = useEditorStore()

  const items = computed<MenuItem[]>(() => [
    ...(editor.linkPlan().kind === 'none' ? [] : [{ id: LINK, label: '合併成一個 Unit', hint: 'Ctrl+E' }]),
    ...(editor.canDetachSelection() ? [{ id: DETACH, label: '從 Unit 移出' }] : []),
  ])

  /** Does what was picked, and says whether it was one of these. */
  function pick(id: string): boolean {
    if (id === LINK) editor.cmdLinkSelection()
    else if (id === DETACH) editor.cmdDetachSelection()
    else return false
    return true
  }

  return { items, pick }
}
