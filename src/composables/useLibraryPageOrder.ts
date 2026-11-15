import { insertPagesAt } from '@shared/project/pages'
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
 * Lands the write on disk before the import is considered done, and says so
 * when it does not: the next open reads `project.json` off disk and would
 * otherwise find the order from before the import.
 *
 * ⛔ The import below may not reject. Its caller lets go of the promise, so a
 * rejection would go unhandled and the user would be told nothing at all.
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

/** A book's full page order and its tombstones, loading the handle first if this is the first import to reach it. */
async function readBookOrder(book: string): Promise<BookOrder> {
  const bookMeta = useBookMetaStore()
  await bookMeta.handleFor(book)
  const order = bookMeta.orderOf(book)
  if (order !== null) return order
  const project = useProjectStore()
  return {
    pages: project.allFiles.map((f) => f.pageId),
    deletedPages: [...(project.projectMeta.deletedPages ?? [])],
  }
}

/**
 * One import per book at a time.
 *
 * An import reads the book's order, works the next one out from it, and pushes
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
 * Turning image files into new pages inserted at a given place. It ends in one
 * call to `editorStore` — the store that owns every book's history, not only
 * the one open right now — so the import is undone with the same `Ctrl+Z` as
 * anything else done to that book.
 */
export function useLibraryPageOrder() {
  const editor = useEditorStore()

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
   * ⛔ A folder already holding a `shashoku/` is left alone, sentinel or not.
   * `createProject` writes a default `project.json` over whatever is there,
   * so the absence of a sentinel cannot be read as "nothing to lose" — a
   * project whose sentinel went missing still has its tags and its page
   * order in that file.
   */
  async function makeBook(book: string): Promise<boolean> {
    try {
      const scan = await window.api.scanRoot(book)
      if (scan.hasSentinel) return true
      if (scan.hasShashokuDir) {
        useNoticeStore().say(`這個資料夾裡已經有 ${SHASHOKU_DIR}/，先沒有動它`)
        return false
      }
      await window.api.createProject(book)
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

  return { importFilesAt }
}
