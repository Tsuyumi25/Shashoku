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
 * `allSettled` rather than `all`, and then raised: every scheduler gets its
 * turn even after one of them throws — `all` would leave the others holding
 * bytes nobody ever asked for again — but the throw still comes back out.
 * Swallowing it was how a full disk closed the window on work it had not
 * written, with nothing on screen either way.
 */
export function useCloseSettle() {
  const editor = useEditorStore()
  const project = useProjectStore()
  const bookMeta = useBookMetaStore()
  const preferences = usePreferencesStore()

  async function settle(): Promise<void> {
    editor.flushTextEdit()
    const tried = await Promise.allSettled([
      project.flush(),
      bookMeta.flushAll(),
      preferences.flush(),
    ])
    const refused = tried.find((one) => one.status === 'rejected')
    if (refused) throw refused.reason
  }

  return { settle }
}
