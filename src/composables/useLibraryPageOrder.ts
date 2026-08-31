import { insertPagesAt, reorderPages } from '@shared/project/pages'
import { DIR_PAGES, SHASHOKU_DIR } from '@shared/ssk/constants'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useEditorStore } from '@/stores/editorStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'

interface BookOrder {
  pages: string[]
  deletedPages: string[]
}

/**
 * Lands the write on disk before the gesture is considered done, and says so
 * when it does not. `listInside` — what the shelf re-reads to show the result
 * — is a main-process read of `project.json`, wholly unaware of the
 * renderer's in-memory store; without this, a reload run right after `do()`
 * would race the debounced autosave and show the order from before the drag.
 *
 * ⛔ Neither gesture below may reject. The shelf lets go of the promise they
 * return, so a rejection would go unhandled and the user would be told
 * nothing at all — which is the failure this is here to end.
 */
async function settleBook(book: string): Promise<void> {
  const project = useProjectStore()
  try {
    if (project.isOpenRoot(book)) await project.flush()
    else await useBookMetaStore().flush(book)
  } catch (err) {
    console.error('page order write failed', err)
    useNoticeStore().say('順序改好了，但沒有存進磁碟')
  }
}

/**
 * A book's full page order and its tombstones, from whichever of the two
 * places holds them right now. `handleFor` already refuses a book the
 * editor has open — the `null` it answers with there is read as "ask
 * `projectStore` instead", the same door `bookMetaStore` itself points
 * callers through.
 */
async function readBookOrder(book: string): Promise<BookOrder> {
  const project = useProjectStore()
  if (!project.isOpenRoot(book)) {
    const handle = await useBookMetaStore().handleFor(book)
    if (handle !== null) {
      return { pages: [...handle.order], deletedPages: [...(handle.meta.deletedPages ?? [])] }
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
    try {
      const { pages, deletedPages } = await readBookOrder(book)
      const after = reorderPages(pages, deletedPages, movedIds, targetIndex)
      editor.cmdSetPageOrder(book, pages, after)
    } catch (err) {
      console.error('reorder failed', err)
      useNoticeStore().say('頁面順序沒有改成功')
      return
    }
    await settleBook(book)
  }

  /**
   * One page per dropped file, made before this ever reaches `editorStore` —
   * `createPage` is irreversible and must run exactly once, never again on a
   * redo — then inserted at `targetIndex` as a single step so `Ctrl+Z` takes
   * the whole batch back together.
   *
   * ⛔ A batch that fails halfway is settled, not abandoned. Every page made
   * before the failure is already a directory on disk; leaving them out of
   * `pages` would have the next open adopt them at the end of the chapter,
   * where nothing on the stack can take them back. Whatever was made goes in
   * at the drop point and onto the stack, and the failure is said out loud.
   */
  async function importFilesAt(
    book: string,
    sourceNames: readonly string[],
    targetIndex: number,
  ): Promise<void> {
    if (sourceNames.length === 0) return
    const ids: string[] = []
    let failed: unknown = null
    for (const name of sourceNames) {
      try {
        ids.push(await window.api.createPage(book, name))
      } catch (err) {
        failed = err
        break
      }
    }

    let placed = 0
    if (ids.length > 0) {
      try {
        const project = useProjectStore()
        const entries = project.isOpenRoot(book)
          ? await Promise.all(
              ids.map((id) =>
                project.loadFreshPage(id, `${book}/${SHASHOKU_DIR}/${DIR_PAGES}/${id}`),
              ),
            )
          : []

        const { pages, deletedPages } = await readBookOrder(book)
        const after = insertPagesAt(pages, deletedPages, ids, targetIndex)
        editor.cmdImportPages(book, ids, entries, after)
        placed = ids.length
        await settleBook(book)
      } catch (err) {
        failed = err
      }
    }

    if (failed === null) return
    console.error('import failed', failed)
    useNoticeStore().say(placed > 0 ? `只有前 ${placed} 個檔案匯入成功` : '這些檔案沒有匯入成功')
  }

  return { reorderPagesTo, importFilesAt }
}
