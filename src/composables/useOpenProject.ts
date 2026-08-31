import { ref } from 'vue'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useCardStore } from '@/stores/cardStore'
import { useEditorStore } from '@/stores/editorStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSelectionStore } from '@/stores/selectionStore'

/**
 * The three ways in, and what they have in common once they are through.
 *
 * None of them changes which workbench is on screen. Switching project is
 * something you do from inside the project manager, and landing on the canvas
 * would take away the grid you opened it to look at.
 */
export function useOpenProject() {
  const project = useProjectStore()
  const editor = useEditorStore()
  const library = useLibraryStore()
  const selection = useSelectionStore()
  const cards = useCardStore()
  const bookMeta = useBookMetaStore()

  /** What went wrong last, in the user's language, for the caller to show. */
  const lastError = ref<string | null>(null)

  /**
   * `leaving` is whichever book was open before this call, or `null` on the
   * first open of a session — read before `open()` runs, since by the time it
   * resolves `projectStore` already names the book being switched to.
   *
   * A book's undo history is no longer cleared on a switch; it survives being
   * switched away from and back to, which is the point of filing it under the
   * book rather than under the workbench. What still has to happen here is
   * closing the book being left: its selection dies with it — the engine's
   * mask registry is a singleton, and `maskReset` clears it whichever book's
   * journals were in there — and any command left on its stack that still
   * names one of those journals has to be cut, along with any session-bound
   * command that reached for the singleton `projectStore` this call is about
   * to hand to a different book.
   */
  async function settle(leaving: string | null): Promise<void> {
    const strandedMasks = selection.reset()
    if (strandedMasks.length > 0) editor.forgetJournals(strandedMasks, 'mask', leaving)
    // Where a card was dragged to is this session's, and the session ends here.
    // The placement is deterministic, so every card comes back where it was.
    cards.reset()
    editor.startOnPage(project.files[0]?.pageId ?? null)
    if (leaving !== null && leaving !== project.rootPath) editor.closeBook(leaving)
    // The book just opened has exactly one writer from now on: this store's
    // own autosave. A cached lightweight session for it would be stale the
    // moment that autosave writes, so it goes rather than risk being read.
    if (project.rootPath !== null) bookMeta.forget(project.rootPath)
    await library.refresh()
  }

  async function guard(open: () => Promise<string | null>): Promise<boolean> {
    lastError.value = null
    const leaving = project.rootPath
    try {
      const opened = await open()
      if (opened === null) return false
      await settle(leaving)
      return true
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  /** This folder holds images; turn it into a project. Writes to disk. */
  const createHere = () => guard(() => project.createNewProject())

  /** This folder is already a project; open it. */
  const openPicked = () => guard(() => project.openExisting())

  /**
   * A shelf gesture on this same book may have left a book-meta write still
   * debounced — flushed first, since `openByPath` reads the file straight off
   * disk and a write still in flight would lose the race, opening the book on
   * whatever order stood before the gesture.
   */
  const openPath = (path: string) =>
    guard(async () => {
      await bookMeta.flush(path)
      return project.openByPath(path)
    })

  return { lastError, createHere, openPicked, openPath }
}
