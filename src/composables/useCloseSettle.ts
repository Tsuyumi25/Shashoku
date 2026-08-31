import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useEditorStore } from '@/stores/editorStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

/**
 * Everything that owes bytes before the window may go.
 *
 * ⭐ Every book with a write still owed, not only the one the editor holds
 * open. An undo made on the shelf writes through that book's own handle on a
 * debounce of its own, and quitting straight after one used to leave it there.
 *
 * `allSettled` rather than `all`: the window holds itself open until the
 * caller answers, so a write that throws must cost that one write and not the
 * reply. Each scheduler has already reported its own failure by then.
 */
export function useCloseSettle() {
  const editor = useEditorStore()
  const project = useProjectStore()
  const bookMeta = useBookMetaStore()
  const preferences = usePreferencesStore()

  async function settle(): Promise<void> {
    editor.flushTextEdit()
    await Promise.allSettled([project.flush(), bookMeta.flushAll(), preferences.flush()])
  }

  return { settle }
}
