import { computed, ref } from 'vue'
import { refOfBlock } from '@shared/mcp/refs'
import type { MenuItem } from '@/components/CanvasMenu.vue'
import { useMergeLayers } from '@/composables/useMergeLayers'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * A text object's own menu, wherever the object is being pointed at. The canvas
 * is one such place and the shelf of the chapter's own objects is another, and
 * what the menu offers must not depend on which — a reader who learned 「製作副本（整句）」
 * on the page is owed the same item on the shelf.
 *
 * One menu per surface: each holds where it stands and which object it opened
 * on, so two surfaces can be pointed at without either closing the other.
 */
export function useObjectMenu() {
  const editor = useEditorStore()
  const project = useProjectStore()
  const merge = useMergeLayers()

  /** Where it stands and which object it is for, or null when it is down. */
  const openOn = ref<{ id: string; at: { x: number; y: number } } | null>(null)

  /** Where the selection's tag picker was opened from the menu, or null. */
  const tagPickerAt = ref<{ x: number; y: number } | null>(null)

  /** The address an agent uses for the object the menu is open on, or null where it has none. */
  const objectRef = computed(() => {
    const id = openOn.value?.id
    const pageId = id === undefined ? null : project.pageOfEntry(id)
    const view = pageId === null ? undefined : project.viewOf(pageId)
    const face = project.faces.find((f) => f.id === project.activeFace)
    return id === undefined || pageId === null || !view || !face ? null : refOfBlock(pageId, face.no, view, id)
  })

  /**
   * A copy of the whole translation, both sides, read right after the original —
   * the copy Ctrl+J and Alt with a drag do not make, since theirs is one block.
   */
  const items = computed<MenuItem[]>(() => [
    ...(objectRef.value === null ? [] : [{ id: 'copy-ref', label: `複製 ref（${objectRef.value}）` }]),
    { id: 'tags', label: '標記…' },
    { id: 'duplicate-unit', label: '製作副本（整句）' },
    { id: 'delete', label: editor.selectedIds.size > 1 ? `刪除（${editor.selectedIds.size} 個）` : '刪除' },
  ])

  /** The object pointed at joins nothing: it is what the menu is about, so it alone is held. */
  function open(id: string, at: { x: number; y: number }) {
    if (!editor.isSelected(id)) editor.selectOnly(id)
    openOn.value = { id, at }
  }

  function close() {
    openOn.value = null
  }

  function pick(choice: string) {
    const on = openOn.value
    const address = objectRef.value
    openOn.value = null
    if (on === null) return
    if (choice === 'copy-ref') {
      if (address === null) return
      navigator.clipboard.writeText(address).then(
        () => useNoticeStore().say(`已複製 ${address}`),
        (err: unknown) => console.error('copy ref failed', err),
      )
      return
    }
    // What the menu opened on is selected, or was already part of a selection,
    // so this is the Delete key's own act and takes the whole selection.
    if (choice === 'delete') {
      editor.deleteSelection()
      return
    }
    if (choice === 'tags') {
      tagPickerAt.value = on.at
      return
    }
    if (choice === 'duplicate-unit') {
      void merge.duplicateLayer({ id: on.id, wholeUnit: true }).catch((err: unknown) =>
        console.error('duplicate failed', err),
      )
    }
  }

  return { openOn, tagPickerAt, items, open, close, pick }
}
