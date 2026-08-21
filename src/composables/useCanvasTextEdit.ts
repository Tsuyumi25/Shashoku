import { computed, nextTick } from 'vue'
import { textOf } from '@shared/page/text'
import { isHidden, isLocked } from '@shared/page/tree'
import type { TextLayerEntry } from '@shared/page/types'
import { useTextEditSurface } from '@/composables/useTextEditSurface'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * Typing into a label from the canvas.
 *
 * The keyboard never comes here: the translation list's box takes it, and this
 * is only what points that box at a label and reads back where its caret ended
 * up. Nothing holds a second copy of the text, which is why there is nothing
 * to reconcile when the same edit is driven from the list instead.
 */
export function useCanvasTextEdit() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const notices = useNoticeStore()
  const preferences = usePreferencesStore()
  const surface = useTextEditSurface()

  /** Which label on the open page is being typed into, if any. */
  const editingId = computed(() => {
    const pending = editor.pendingTextEdit
    if (pending === null || pending.pageId !== editor.currentPageId) return null
    return pending.labelId
  })

  /**
   * Whether this object is out of bounds for typing, saying why when it is.
   *
   * Both refusals are about work whose result could not be seen — the same pair
   * the pixel tools refuse on, and inherited through folders the same way. A box
   * that opened and then swallowed every keystroke would be worse than a
   * refusal, which is why this is asked before the caret exists rather than
   * after.
   */
  function refuse(pageId: string, label: TextLayerEntry): boolean {
    const layers = project.pageById(pageId)?.page.layers ?? []
    if (isLocked(layers, label.id)) {
      notices.say('這個物件鎖定中，改不了')
      return true
    }
    if (isHidden(layers, label.id)) {
      notices.say('這個物件是隱藏的，改不了')
      return true
    }
    // A selection built on purpose is not something to drop on the way into a
    // single-object act, which is the rule the translation list already keeps.
    if (editor.selectedIds.size > 1) {
      notices.say('選了多個物件，先選一個再編輯')
      return true
    }
    return false
  }

  /**
   * The box arrives with the row it belongs to, which is a render away — one
   * turn for the panel to put the list up, one for the row to swap its preview
   * for an input.
   *
   * Always at least one turn, never an early return on whatever is registered
   * now: opening a second object while a first is open finds the first one's
   * box still standing, and focusing that would put the caret in a row about to
   * be taken away.
   */
  async function fieldAppears(): Promise<HTMLTextAreaElement | null> {
    await nextTick()
    if (surface.field.value === null) await nextTick()
    return surface.field.value
  }

  /**
   * Start typing into `label`, with the caret at `index`.
   *
   * ⚠️ Transitional: the translation list has to be the panel on screen, since
   * its box is what holds the keyboard. The line that switches panels goes when
   * the tree and the list become one panel.
   */
  async function enterAt(pageId: string, label: TextLayerEntry, index: number): Promise<void> {
    if (refuse(pageId, label)) return
    preferences.setSidePanel('labels')
    editor.revealLabel(pageId, label.id)
    editor.beginTextEdit(pageId, label.id, textOf(label))
    const field = await fieldAppears()
    if (field === null) return
    field.focus({ preventScroll: true })
    surface.setRange(index)
  }

  return {
    editingId,
    range: surface.range,
    moved: surface.moved,
    enterAt,
    setRange: surface.setRange,
  }
}
