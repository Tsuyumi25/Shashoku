import { useUiStore } from '@/stores/uiStore'

export function useNewProjectDrop() {
  const ui = useUiStore()

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  function onDrop(e: DragEvent) {
    const file = e.dataTransfer?.files[0]
    if (!file) return
    e.preventDefault()
    const path = window.api.pathForFile(file)
    if (path) ui.openNewProject(path)
  }

  return { onDragOver, onDrop }
}
