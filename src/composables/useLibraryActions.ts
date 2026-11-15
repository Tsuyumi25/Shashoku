import { useToast } from 'vue-toastification'
import { useOpenProject } from '@/composables/useOpenProject'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

export function useLibraryActions() {
  const project = useProjectStore()
  const ui = useUiStore()
  const toast = useToast()
  const { openPath, lastError } = useOpenProject()

  async function open(path: string): Promise<void> {
    if (path === project.folderPath) {
      ui.setView('editor')
      return
    }
    if (await openPath(path)) ui.setView('editor')
    else if (lastError.value) toast.error(lastError.value)
  }

  async function reveal(path: string): Promise<void> {
    const reason = await window.api.openProjectFolder(path)
    if (reason) toast.error(`開不了資料夾:${reason}`)
  }

  return { open, reveal }
}
