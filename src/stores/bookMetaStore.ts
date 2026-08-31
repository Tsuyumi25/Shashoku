import { defineStore } from 'pinia'
import { defaultProjectJson, parseProjectJson, serializeProjectJson } from '@shared/project/schema'
import type { ProjectJson } from '@shared/project/types'
import { SHASHOKU_DIR } from '@shared/ssk/constants'
import { createAutosave, type Autosave } from '@/lib/autosave'
import { useProjectStore } from '@/stores/projectStore'

/**
 * A book's `project.json`, held in memory for a caller that is not the
 * editor — the library, working on a book nobody has opened.
 *
 * `order` is kept apart from `meta` even though it is `meta.pages`: a future
 * page-order command swaps this wholesale, the same before/after `string[]`
 * pair the pixel side already uses, and folding it into a patch of `meta`
 * would make that command's `do`/`undo` reach into an object to change one
 * field of it instead of handing over a value.
 */
export interface BookMetaSession {
  meta: ProjectJson
  order: string[]
  dirty: boolean
}

function shashokuDirOf(rootPath: string): string {
  return `${rootPath}/${SHASHOKU_DIR}`
}

function sessionFrom(raw: string | null): BookMetaSession {
  const meta = raw === null ? defaultProjectJson() : parseProjectJson(raw)
  return { meta, order: [...meta.pages], dirty: false }
}

/**
 * The book-meta session: a book's `project.json` read once and cached, for
 * whatever in the library wants to change a book that is not the one loaded
 * in the editor.
 *
 * ⛔ Refuses the book the editor already has open. That book's `project.json`
 * has exactly one writer, `projectStore`'s own autosave, which rewrites the
 * whole file from `allFiles` on every flush — a second writer here would lose
 * whatever it wrote the moment that autosave runs, with nothing to say so.
 * The caller has to go through `projectStore` instead for that book.
 *
 * One `Autosave` per book rather than one write per change: `do → undo →
 * redo` faster than a flush must still leave the disk agreeing with the
 * screen, and `Autosave` already gives that for free by reading the session's
 * current state on the way out rather than the state a mark closed over.
 */
export const useBookMetaStore = defineStore('bookMeta', () => {
  const sessions = new Map<string, BookMetaSession>()
  const writers = new Map<string, Autosave>()
  const loading = new Map<string, Promise<BookMetaSession>>()

  function writerFor(rootPath: string): Autosave {
    const existing = writers.get(rootPath)
    if (existing) return existing
    const writer = createAutosave(() => flushNow(rootPath), {
      onError: (err) => console.error('book meta autosave failed', err),
    })
    writers.set(rootPath, writer)
    return writer
  }

  async function flushNow(rootPath: string): Promise<void> {
    const session = sessions.get(rootPath)
    if (!session || !session.dirty) return
    session.dirty = false
    try {
      await window.api.writeProjectMeta(
        shashokuDirOf(rootPath),
        serializeProjectJson({ ...session.meta, pages: session.order }),
      )
    } catch (err) {
      session.dirty = true
      throw err
    }
  }

  /**
   * The session for a book not open in the editor, read once and cached from
   * then on. Concurrent callers asking for the same book before the first
   * read lands share that one read rather than firing a second.
   */
  async function sessionFor(rootPath: string): Promise<BookMetaSession | null> {
    if (useProjectStore().isOpenRoot(rootPath)) return null
    const cached = sessions.get(rootPath)
    if (cached) return cached
    const already = loading.get(rootPath)
    if (already) return already
    const started = (async () => {
      const raw = await window.api.readProjectMeta(rootPath)
      const session = sessionFrom(raw)
      sessions.set(rootPath, session)
      return session
    })()
    loading.set(rootPath, started)
    try {
      return await started
    } finally {
      loading.delete(rootPath)
    }
  }

  /**
   * Replaces a cached session's page order and schedules the write. Answers
   * `false` without touching anything for a book the editor has open, or one
   * `sessionFor` has not loaded yet — the caller reads a session before it
   * can change one.
   */
  function setOrder(rootPath: string, order: readonly string[]): boolean {
    if (useProjectStore().isOpenRoot(rootPath)) return false
    const session = sessions.get(rootPath)
    if (!session) return false
    session.order = [...order]
    session.dirty = true
    writerFor(rootPath).mark()
    return true
  }

  /** Writes now, and resolves once nothing for this book is left pending. */
  function flush(rootPath: string): Promise<void> {
    return writerFor(rootPath).flush()
  }

  /**
   * Drops a cached session — the library moved on to somewhere else, or the
   * book was just opened for real and `projectStore` is the writer now.
   */
  function forget(rootPath: string): void {
    sessions.delete(rootPath)
    writers.get(rootPath)?.cancel()
    writers.delete(rootPath)
  }

  return { sessionFor, setOrder, flush, forget }
})
