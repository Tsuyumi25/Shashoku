import { LAYER_ORDER_MENU, restackOf } from '@/lib/layerOrderMenu'
import { computed, ref } from 'vue'
import { refOfBlock } from '@shared/mcp/refs'
import { shownCodeOf } from '@shared/page/units'
import type { MenuItem } from '@/components/CanvasMenu.vue'
import { useMergeLayers } from '@/composables/useMergeLayers'
import { useUnitMenu } from '@/composables/useUnitMenu'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * A text object's own menu, wherever the object is being pointed at. The canvas
 * is one such place and the shelf of the chapter's own objects is another, and
 * what the menu offers must not depend on which — a reader who learned 「製作副本（整個 Unit）」
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

  const unitMenu = useUnitMenu()

  /**
   * A copy of the whole translation, both sides, read right after the original —
   * the copy Ctrl+J and Alt with a drag do not make, since theirs is one block.
   */
  const items = computed<MenuItem[]>(() => [
    ...(objectRef.value === null ? [] : [{ id: 'copy-ref', label: `複製 ref（${objectRef.value}）` }]),
    { id: 'tags', label: '標記…' },
    { id: 'duplicate-unit', label: '製作副本（整個 Unit）' },
    ...(collectable.value.length === 0
      ? []
      : [
          {
            id: 'collect-global',
            label: collectable.value.length > 1 ? `收錄進全域素材（${collectable.value.length} 個）` : '收錄進全域素材',
          },
        ]),
    ...unitMenu.items.value,
    LAYER_ORDER_MENU,
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
    if (unitMenu.pick(choice)) return
    const how = restackOf(choice)
    if (how !== null) {
      // The page of what was pointed at, which the shelf can open on without turning to it.
      editor.cmdRestackSelection(how, project.pageOfEntry(on.id))
      return
    }
    if (choice === 'tags') {
      tagPickerAt.value = on.at
      return
    }
    if (choice === 'collect-global') {
      collectGlobal()
      return
    }
    if (choice === 'duplicate-unit') {
      void merge.duplicateLayer({ id: on.id, wholeUnit: true }).catch((err: unknown) =>
        console.error('duplicate failed', err),
      )
    }
  }

  /**
   * The selection's text objects with words in them, as they look now. A lock
   * holds an object still on its page; copying how it looks does not move it.
   */
  const collectable = computed(() =>
    [...editor.selectedIds].flatMap((id) => {
      const entry = project.entryById(id)
      if (entry?.kind !== 'text') return []
      const code = shownCodeOf(entry)
      return code.trim() ? [{ code, style: entry.body.style, effects: entry.effects }] : []
    }),
  )

  function collectGlobal() {
    const items = collectable.value
    if (items.length === 0) return
    usePreferencesStore().collectGlobalMaterials(items)
    useNoticeStore().say(`已收錄 ${items.length} 個到全域素材`)
  }

  return { openOn, tagPickerAt, items, open, close, pick }
}
