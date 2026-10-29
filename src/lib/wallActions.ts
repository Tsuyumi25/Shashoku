import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

/**
 * What a gesture on the wall does in the editor. The wall stands in a window of
 * its own, so these run here when it says so.
 */

/** Back to the page, with the piece selected where it stands. */
export function revealPiece(pageId: string, id: string): void {
  const editor = useEditorStore()
  editor.showPage(pageId)
  editor.selectOnly(id)
  useUiStore().setView('editor')
}

/** A bucket or a meaning picked whole, as a row of the semantic buckets did. */
export function selectPieces(ids: readonly string[]): void {
  const project = useProjectStore()
  // The wall in another window may be a beat behind; what is gone is passed over.
  useEditorStore().selectMany(
    ids.filter((id) => project.pageOfEntry(id) !== null),
    false,
  )
}

export function brushMeaning(tags: readonly string[]): void {
  const editor = useEditorStore()
  editor.loadPaintTags(tags)
  editor.setTool('tag-paint')
  useUiStore().setView('editor')
}
