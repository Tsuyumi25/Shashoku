import { insertPagesAt, reorderPages } from '@shared/project/pages'
import { DIR_PAGES, SHASHOKU_DIR } from '@shared/ssk/constants'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { useEditorStore } from '@/stores/editorStore'
import { useLibraryStore } from '@/stores/libraryStore'
import { useNoticeStore } from '@/stores/noticeStore'
import { useProjectStore } from '@/stores/projectStore'

interface BookOrder {
  pages: string[]
  deletedPages: string[]
}

/**
 * Lands the write on disk before the gesture is considered done, and says so
 * when it does not. The shelf shows the result from the store rather than
 * from the folder, so this is not what makes the cards move — it is what
 * makes the answer survive the next open, which reads `project.json` off disk
 * and would otherwise find the order from before the drag.
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
 * A book's full page order and its tombstones, loading the handle first if
 * this is the first gesture to reach that book.
 *
 * ⭐ Every card the shelf drew is taken in before anything is measured. A
 * page directory the list does not name yet is one the shelf shows and a
 * gesture could not see, so it could be picked up and not moved; and the
 * order this gesture is about to write has to name it, or the write would
 * quietly leave it out of the chapter altogether.
 */
async function readBookOrder(book: string): Promise<BookOrder> {
  const bookMeta = useBookMetaStore()
  await bookMeta.handleFor(book)
  const library = useLibraryStore()
  // Only the book the shelf is actually standing in: `bandPages` describes
  // that one folder, and it is the only book a gesture can start from.
  if (library.standingAt === book) {
    bookMeta.adopt(
      book,
      library.bandPages.map((leaf) => leaf.id),
    )
  }
  const order = bookMeta.orderOf(book)
  if (order !== null) return order
  const project = useProjectStore()
  return {
    pages: project.allFiles.map((f) => f.pageId),
    deletedPages: [...(project.projectMeta.deletedPages ?? [])],
  }
}

/**
 * One gesture per book at a time.
 *
 * Both gestures read the book's order, work the next one out from it, and push
 * a command carrying both ends. Two of them overlapping would each read the
 * order that stood before either ran, so the second would compute its `after`
 * — and the `before` its own undo restores — against an order already gone.
 *
 * Outside the composable: the queue belongs to the book, and every caller has
 * to join the same one.
 */
const turns = new Map<string, Promise<unknown>>()

function inTurn<T>(book: string, work: () => Promise<T>): Promise<T> {
  const queued = (turns.get(book) ?? Promise.resolve()).then(work, work)
  turns.set(
    book,
    queued.catch(() => {}),
  )
  return queued
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
  function reorderPagesTo(
    book: string,
    movedIds: readonly string[],
    targetIndex: number,
  ): Promise<void> {
    if (movedIds.length === 0) return Promise.resolve()
    return inTurn(book, async () => {
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
    })
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
  function importFilesAt(
    book: string,
    sourceNames: readonly string[],
    targetIndex: number,
    create = false,
  ): Promise<void> {
    if (sourceNames.length === 0) return Promise.resolve()
    return inTurn(book, () => importNow(book, sourceNames, targetIndex, create))
  }

  /**
   * ⛔ Asks the disk again rather than trusting the caller's answer:
   * `createProject` writes a default `project.json`, so running it over one
   * that is already there would take the tags, the glossary and the page order
   * with it.
   */
  async function makeBook(book: string): Promise<boolean> {
    try {
      const scan = await window.api.scanRoot(book)
      if (!scan.hasSentinel) await window.api.createProject(book)
      return true
    } catch (err) {
      console.error('create book failed', err)
      useNoticeStore().say('這個資料夾沒有變成書')
      return false
    }
  }

  async function importNow(
    book: string,
    sourceNames: readonly string[],
    targetIndex: number,
    create: boolean,
  ): Promise<void> {
    if (create && !(await makeBook(book))) return
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
