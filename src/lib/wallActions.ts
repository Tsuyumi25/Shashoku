import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

/**
 * What a gesture on the wall does in the editor. The wall stands in a window of
 * its own, so these run here when it says so.
 */

/**
 * Back to the page, with the piece selected where it stands — on the side it
 * is on, since the wall may be showing sources while the editor shows
 * translations, and a piece selected on the hidden side is nowhere to be seen.
 */
export function revealPiece(pageId: string, id: string): void {
  const editor = useEditorStore()
  editor.showPage(pageId)
  const entry = useProjectStore().entryById(id)
  if (entry?.kind === 'text' && entry.side !== editor.textSide) editor.setTextSide(entry.side)
  editor.selectOnly(id)
  useUiStore().setView('editor')
}

/** A bucket or a meaning picked whole, as a row of the semantic buckets did. */
export function selectPieces(ids: readonly string[]): void {
  const project = useProjectStore()
  // The wall in another window may be a beat behind; what is gone is passed over.
  const editor = useEditorStore()
  const kept = ids.filter((id) => project.pageOfEntry(id) !== null)
  // A bucket is all one side, and the editor turns to it so what is picked shows.
  const first = kept.length ? project.entryById(kept[0]!) : undefined
  if (first?.kind === 'text' && first.side !== editor.textSide) editor.setTextSide(first.side)
  editor.selectMany(kept, false)
}

export function brushMeaning(tags: readonly string[]): void {
  const editor = useEditorStore()
  editor.loadPaintTags(tags)
  editor.setTool('tag-paint')
  useUiStore().setView('editor')
}
