import { insertPagesAt, reorderPages } from '@shared/project/pages'
import { DIR_PAGES, SHASHOKU_DIR } from '@shared/ssk/constants'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

interface BookOrder {
  pages: string[]
  deletedPages: string[]
}

/**
 * Lands the write on disk before the gesture is considered done. `listInside`
 * — what the shelf re-reads to show the result — is a main-process read of
 * `project.json`, wholly unaware of the renderer's in-memory store; without
 * this, a reload run right after `do()` would race the debounced autosave
 * and show the order from before the drag.
 */
async function flushBook(book: string): Promise<void> {
  const project = useProjectStore()
  if (project.isOpenRoot(book)) await project.flush()
  else await useBookMetaStore().flush(book)
}

/**
 * A book's full page order and its tombstones, from whichever of the two
 * places holds them right now. `sessionFor` already refuses a book the
 * editor has open — the `null` it answers with there is read as "ask
 * `projectStore` instead", the same door `bookMetaStore` itself points
 * callers through.
 */
async function readBookOrder(book: string): Promise<BookOrder> {
  const project = useProjectStore()
  if (!project.isOpenRoot(book)) {
    const session = await useBookMetaStore().sessionFor(book)
    if (session !== null) {
      return { pages: [...session.order], deletedPages: [...(session.meta.deletedPages ?? [])] }
    }
  }
  return {
    pages: project.allFiles.map((f) => f.pageId),
    deletedPages: [...(project.projectMeta.deletedPages ?? [])],
  }
}

/**
 * The two gestures Ctrl+Drag makes on the page band: reordering pages
 * already in the chapter, and turning dropped files into new ones inserted
 * where the pointer let go. Both end in one call to `editorStore` — the
 * store that owns every book's history, not only the one open right now —
 * so `Ctrl+Z` from the shelf and `Ctrl+Z` from the editor are the same
 * mechanism reaching two different books.
 */
export function useLibraryPageOrder() {
  const editor = useEditorStore()

  /**
   * `movedIds` land at `targetIndex`, measured with those same pages already
   * excluded — the coordinate system a drop point is read against once the
   * cards being dragged are read out of the grid.
   */
  async function reorderPagesTo(
    book: string,
    movedIds: readonly string[],
    targetIndex: number,
  ): Promise<void> {
    if (movedIds.length === 0) return
    const { pages, deletedPages } = await readBookOrder(book)
    const after = reorderPages(pages, deletedPages, movedIds, targetIndex)
    editor.cmdSetPageOrder(book, pages, after)
    await flushBook(book)
  }

  /**
   * One page per dropped file, made before this ever reaches `editorStore` —
   * `createPage` is irreversible and must run exactly once, never again on a
   * redo — then inserted at `targetIndex` as a single step so `Ctrl+Z` takes
   * the whole batch back together.
   */
  async function importFilesAt(
    book: string,
    sourceNames: readonly string[],
    targetIndex: number,
  ): Promise<void> {
    if (sourceNames.length === 0) return
    const ids: string[] = []
    for (const name of sourceNames) ids.push(await window.api.createPage(book, name))

    const project = useProjectStore()
    const openHere = project.isOpenRoot(book)
    const entries = openHere
      ? await Promise.all(
          ids.map((id) =>
            project.loadFreshPage(id, `${book}/${SHASHOKU_DIR}/${DIR_PAGES}/${id}`),
          ),
        )
      : []

    const { pages, deletedPages } = await readBookOrder(book)
    const after = insertPagesAt(pages, deletedPages, ids, targetIndex)
    editor.cmdImportPages(book, ids, entries, after)
    await flushBook(book)
  }

  return { reorderPagesTo, importFilesAt }
}
