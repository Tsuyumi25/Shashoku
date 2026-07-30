import { ref } from 'vue'
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

  /** What went wrong last, in the user's language, for the caller to show. */
  const lastError = ref<string | null>(null)

  async function settle(): Promise<void> {
    // The history belongs to the project that made it; a redo across a switch
    // would replay one project's command against another's pages. A selection
    // goes the same way, since two projects can hold a page of the same name.
    editor.clearHistory()
    selection.reset()
    editor.selectFile(project.files[0]?.filename ?? null)
    await library.refresh()
  }

  async function guard(open: () => Promise<string | null>): Promise<boolean> {
    lastError.value = null
    try {
      const opened = await open()
      if (opened === null) return false
      await settle()
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

  const openPath = (path: string) => guard(() => project.openByPath(path))

  return { lastError, createHere, openPicked, openPath }
}
