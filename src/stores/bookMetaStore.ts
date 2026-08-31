import { defineStore } from 'pinia'
import { defaultProjectJson, parseProjectJson, serializeProjectJson } from '@shared/project/schema'
import type { ProjectJson } from '@shared/project/types'
import { SHASHOKU_DIR } from '@shared/ssk/constants'
import { applyPageOrderSnapshot } from '@shared/project/pages'
import { createAutosave, type Autosave } from '@/lib/autosave'
import { useProjectStore } from '@/stores/projectStore'

/**
 * A book's `project.json`, held in memory under the book's own path.
 *
 * `order` is kept apart from `meta` even though it is `meta.pages`: the
 * page-order command hands over a whole `string[]`, the same before/after
 * pair the pixel side already uses, and folding it into a patch of `meta`
 * would make that command's `do`/`undo` reach into an object to change one
 * field of it instead of handing over a value.
 */
export interface BookHandle {
  meta: ProjectJson
  order: string[]
  dirty: boolean
}

function shashokuDirOf(rootPath: string): string {
  return `${rootPath}/${SHASHOKU_DIR}`
}

function handleFrom(raw: string | null): BookHandle {
  const meta = raw === null ? defaultProjectJson() : parseProjectJson(raw)
  return { meta, order: [...meta.pages], dirty: false }
}

/**
 * The handle a book is held by: its `project.json`, addressed by the book's
 * path rather than by whatever was writing it when a command was pushed.
 *
 * ⭐ How long a handle lives is decided by the history pointing at it, not by
 * whether the editor has the book open. A reorder made from the shelf can be
 * undone after that book has been opened, and after it has been left again;
 * both of those change which writer owns the book, and neither may take the
 * handle away from underneath a command that still names it.
 *
 * ⛔ Still refuses to read or write the book the editor has open. That book's
 * `project.json` has exactly one writer, `projectStore`'s own autosave, which
 * rewrites the whole file from `allFiles` on every flush — a second writer
 * here would lose whatever it wrote the moment that autosave runs, with
 * nothing to say so. What changed is that refusing is no longer the same as
 * forgetting: the handle stays, and `handBack` refreshes it on the way out.
 *
 * One `Autosave` per book rather than one write per change: `do → undo →
 * redo` faster than a flush must still leave the disk agreeing with the
 * screen, and `Autosave` already gives that for free by reading the handle's
 * current state on the way out rather than the state a mark closed over.
 */
export const useBookMetaStore = defineStore('bookMeta', () => {
  const handles = new Map<string, BookHandle>()
  const writers = new Map<string, Autosave>()
  const loading = new Map<string, Promise<BookHandle>>()

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
    const handle = handles.get(rootPath)
    if (!handle || !handle.dirty) return
    handle.dirty = false
    try {
      await window.api.writeProjectMeta(
        shashokuDirOf(rootPath),
        serializeProjectJson({ ...handle.meta, pages: handle.order }),
      )
    } catch (err) {
      handle.dirty = true
      throw err
    }
  }

  /**
   * The handle for a book not open in the editor, read once and kept from
   * then on. Concurrent callers asking for the same book before the first
   * read lands share that one read rather than firing a second.
   */
  async function handleFor(rootPath: string): Promise<BookHandle | null> {
    if (useProjectStore().isOpenRoot(rootPath)) return null
    const cached = handles.get(rootPath)
    if (cached) return cached
    const already = loading.get(rootPath)
    if (already) return already
    const started = (async () => {
      const raw = await window.api.readProjectMeta(rootPath)
      const handle = handleFrom(raw)
      handles.set(rootPath, handle)
      return handle
    })()
    loading.set(rootPath, started)
    try {
      return await started
    } finally {
      loading.delete(rootPath)
    }
  }

  /**
   * Puts the pages `snapshot` covers back into its order and schedules the
   * write, every page it does not cover holding its own slot. Answers `false`
   * without touching anything for a book the editor has open, one `handleFor`
   * has not loaded yet — the caller reads a handle before it can change one —
   * or a snapshot that conflicts with a page the reader can see.
   */
  function applyOrderSnapshot(rootPath: string, snapshot: readonly string[]): boolean {
    if (useProjectStore().isOpenRoot(rootPath)) return false
    const handle = handles.get(rootPath)
    if (!handle) return false
    const next = applyPageOrderSnapshot(handle.order, handle.meta.deletedPages ?? [], snapshot)
    if (next === null) return false
    handle.order = next
    handle.dirty = true
    writerFor(rootPath).mark()
    return true
  }

  /**
   * The one write that widens a book's page list: names that were not in it
   * before, at the slots `order` puts them.
   *
   * Separate from `applyOrderSnapshot` because it is the opposite operation —
   * that one permutes the slots a chapter already has and can never add to
   * them. Called once, when the drop lands, on an `order` worked out from the
   * list as it stands at that moment; a redo of the same import lifts the
   * tombstone instead, and never comes back through here.
   */
  function placePages(rootPath: string, order: readonly string[]): boolean {
    if (useProjectStore().isOpenRoot(rootPath)) return false
    const handle = handles.get(rootPath)
    if (!handle) return false
    handle.order = [...order]
    handle.dirty = true
    writerFor(rootPath).mark()
    return true
  }

  /** Writes now, and resolves once nothing for this book is left pending. */
  function flush(rootPath: string): Promise<void> {
    return writers.get(rootPath)?.flush() ?? Promise.resolve()
  }

  /**
   * Every book with a write still debounced lands it now.
   *
   * Awaited before any open, whichever of the three doors it came through: an
   * open reads `project.json` straight off disk, and a lightweight write that
   * landed afterwards would leave the editor holding an order one gesture
   * behind — which its own autosave would then write back over the top of.
   */
  async function flushAll(): Promise<void> {
    await Promise.all([...writers.keys()].map((rootPath) => flush(rootPath)))
  }

  /**
   * Takes the book back from the editor: the handle now holds what
   * `projectStore` holds, and a book the shelf never read gets a handle here
   * for the first time.
   *
   * Called while that store still names this book — by the time an open has
   * resolved, the singleton already describes the book being switched to, and
   * the order that was in it is gone. A book reordered from the shelf while it
   * was the open one has commands on its stack that will route here from now
   * on, and this is what leaves them something current to write.
   *
   * `dirty` is carried over rather than cleared: a write this handle had
   * already scheduled is still owed, and the order handed back is the one that
   * should land.
   */
  function handBack(rootPath: string, meta: ProjectJson, order: readonly string[]): void {
    handles.set(rootPath, {
      meta: { ...meta },
      order: [...order],
      dirty: handles.get(rootPath)?.dirty ?? false,
    })
  }

  /**
   * Tombstones names in a handle, the same way `projectStore.tagPagesDeleted`
   * does for the book that is open — the name stays in `order`, only its
   * visibility changes. Answers `false` under the same two conditions
   * `setOrder` does.
   */
  function tagDeleted(rootPath: string, pageIds: readonly string[]): boolean {
    if (useProjectStore().isOpenRoot(rootPath)) return false
    const handle = handles.get(rootPath)
    if (!handle) return false
    const marked = new Set(handle.meta.deletedPages ?? [])
    for (const id of pageIds) marked.add(id)
    handle.meta = { ...handle.meta, deletedPages: [...marked] }
    handle.dirty = true
    writerFor(rootPath).mark()
    return true
  }

  /** Peels the tombstone back off, the mirror of `tagDeleted`. */
  function untagDeleted(rootPath: string, pageIds: readonly string[]): boolean {
    if (useProjectStore().isOpenRoot(rootPath)) return false
    const handle = handles.get(rootPath)
    if (!handle) return false
    const taking = new Set(pageIds)
    handle.meta = {
      ...handle.meta,
      deletedPages: (handle.meta.deletedPages ?? []).filter((id) => !taking.has(id)),
    }
    handle.dirty = true
    writerFor(rootPath).mark()
    return true
  }

  /** Drops a handle outright, whatever it was still holding. */
  function forget(rootPath: string): void {
    handles.delete(rootPath)
    writers.get(rootPath)?.cancel()
    writers.delete(rootPath)
  }

  /**
   * Lets a handle go now that no history names its book — the bound on how
   * many books keep a stack lives in `editorStore`, and this is the cache
   * following it rather than growing one entry per book a session ever
   * glanced at.
   *
   * A handle with a write still owed stays until that write lands. Dropping it
   * would be the one way a change already accepted from the user could
   * disappear without anything saying so.
   */
  async function retire(rootPath: string): Promise<void> {
    if (!handles.has(rootPath)) return
    await flush(rootPath)
    if (handles.get(rootPath)?.dirty) return
    forget(rootPath)
  }

  return {
    handleFor,
    applyOrderSnapshot,
    placePages,
    tagDeleted,
    untagDeleted,
    flush,
    flushAll,
    handBack,
    forget,
    retire,
  }
})
