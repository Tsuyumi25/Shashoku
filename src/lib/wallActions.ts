import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

/**
 * What a gesture on the wall does in the editor. The wall stands in a window of
 * its own, so these run here when it says so.
 */

/** The editor turned to the side, and the face, a piece of text is on. */
function turnTo(entry: ReturnType<ReturnType<typeof useProjectStore>['entryById']>): void {
  if (entry?.kind !== 'text') return
  const editor = useEditorStore()
  if (entry.side === 'translation' && entry.face !== useProjectStore().activeFace) editor.setActiveFace(entry.face)
  if (entry.side !== editor.textSide) editor.setTextSide(entry.side)
}

/**
 * Back to the page, with the piece selected where it stands — on the side it
 * is on, since the wall may be showing sources while the editor shows
 * translations, and a piece selected on the hidden side is nowhere to be seen.
 */
export function revealPiece(pageId: string, id: string): void {
  const editor = useEditorStore()
  // The wall may be a beat behind, as in `selectPieces`: a piece gone since is
  // not selected, or what acts on the selection would act on nothing.
  const entry = useProjectStore().entryById(id)
  if (entry === undefined) return
  editor.showPage(pageId)
  turnTo(entry)
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
  turnTo(kept.length ? project.entryById(kept[0]!) : undefined)
  editor.selectMany(kept, false)
}

export function brushMeaning(tags: readonly string[]): void {
  const editor = useEditorStore()
  editor.loadPaintTags(tags)
  editor.setTool('tag-paint')
  useUiStore().setView('editor')
}
