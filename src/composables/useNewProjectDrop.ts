import { useLibraryStore } from '@/stores/libraryStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useUiStore } from '@/stores/uiStore'

/**
 * A folder dropped on the library. One that is already a project is filed —
 * into the 收藏夾 it landed on, or else into 全部 — and anything else opens the
 * new-project modal with it as the source.
 */
export function useNewProjectDrop() {
  const ui = useUiStore()
  const library = useLibraryStore()

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  async function take(e: DragEvent, favoriteId: string | null): Promise<void> {
    const file = e.dataTransfer?.files[0]
    if (!file) return
    e.preventDefault()
    const path = window.api.pathForFile(file)
    if (!path) return
    const scan = await window.api.scanRoot(path).catch(() => null)
    if (!scan?.hasSentinel) {
      ui.openNewProject(path, favoriteId)
      return
    }
    if (favoriteId !== null) await library.addPathToFavorite(favoriteId, path)
    else await library.remember(path)
    useNoticeStore().say('已經是專案，收進來了')
  }

  return {
    onDragOver,
    onDrop: (e: DragEvent) => void take(e, null),
    onDropInto: (favoriteId: string) => (e: DragEvent) => {
      e.stopPropagation()
      void take(e, favoriteId)
    },
  }
}
