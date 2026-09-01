import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  buildWorkspaceTree,
  crumbsFor,
  distinctBooks,
  type DirEntry,
  type FolderContents,
  type LibraryNode,
  type ShelfLeaf,
} from '@shared/project/workspace'
import { useBookMetaStore } from '@/stores/bookMetaStore'
import { usePreferencesStore } from '@/stores/preferencesStore'

/** Names beside covers, or covers with names under them. */
export type LibraryView = 'list' | 'thumbnail'

/**
 * The shelf's two territories. Each owns its own selection, anchor and
 * hit-test list; touching one always empties the other. `project` covers the
 * folder's pages and the books standing in it, drawn as two sections of one
 * territory, and `file` is whatever is left lying beside them.
 */
export type ShelfRegion = 'project' | 'file'

/**
 * One card. A page is named inside its book, a file by where it lies — the
 * same split `ShelfRegion` runs along.
 */
export type ShelfItem =
  | { kind: 'page'; key: string; page: ShelfLeaf }
  | { kind: 'entry'; key: string; entry: DirEntry }

export function pageKey(page: ShelfLeaf): string {
  return `page:${page.id}`
}

export function entryKey(entry: DirEntry): string {
  return `entry:${entry.path}`
}

function pageItem(page: ShelfLeaf): ShelfItem {
  return { kind: 'page', key: pageKey(page), page }
}

function entryItem(entry: DirEntry): ShelfItem {
  return { kind: 'entry', key: entryKey(entry), entry }
}

function empty(): FolderContents {
  return { book: false, pages: [], entries: [] }
}

function entryOf(node: LibraryNode): DirEntry {
  return {
    name: node.name,
    path: node.path,
    folder: true,
    book: node.kind === 'book',
    own: false,
    cover: node.cover,
    pageCount: node.kind === 'book' ? node.pageCount : null,
    books: node.kind === 'folder' ? node.books : null,
  }
}

export const useLibraryStore = defineStore('library', () => {
  const roots = ref<LibraryNode[]>([])
  /**
   * Books on the disk, not books summed over the entry points: two entry
   * points that overlap both report what they reach, and adding those up
   * counts the shared ones twice.
   */
  const bookTotal = ref(0)
  const scanning = ref(false)

  const standingAt = ref<string | null>(null)
  const inside = ref<FolderContents>(empty())
  const insideLoading = ref(false)

  const view = ref<LibraryView>('thumbnail')

  let inFlight: Promise<void> | null = null
  let queued = false

  /**
   * Coalesced: the side column and the shelf mount together on a cold start,
   * and one walk of the disk serves both. A request arriving mid-scan queues
   * one more pass instead of joining silently — its workspaces may not have
   * existed when the running scan set out.
   */
  async function refresh(): Promise<void> {
    if (inFlight) {
      queued = true
      return inFlight
    }
    inFlight = (async () => {
      const preferences = usePreferencesStore()
      do {
        queued = false
        scanning.value = true
        try {
          // Copied out of the store: structured clone refuses a reactive Proxy,
          // and says only that an object could not be cloned when it meets one.
          const scan = await window.api.scanWorkspaces([...preferences.prefs.workspaces])
          roots.value = buildWorkspaceTree(scan)
          bookTotal.value = distinctBooks(scan)
        } finally {
          scanning.value = false
        }
      } while (queued)
      await loadInside(standingAt.value)
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function addWorkspace(): Promise<boolean> {
    const path = await window.api.pickWorkspace()
    if (path === null) return false
    if (!usePreferencesStore().addWorkspace(path)) return false
    await refresh()
    return true
  }

  async function removeWorkspace(path: string): Promise<void> {
    usePreferencesStore().removeWorkspace(path)
    if (standingAt.value !== null && crumbs.value[0]?.path === path) standAt(null)
    await refresh()
  }

  /** Which load the pending work belongs to, so a stale one cannot land. */
  let insideGeneration = 0

  async function loadInside(path: string | null): Promise<void> {
    const mine = ++insideGeneration
    inside.value = empty()
    if (path === null) {
      insideLoading.value = false
      resetFocus()
      return
    }
    insideLoading.value = true
    try {
      const contents = await window.api.listInside(path)
      if (mine !== insideGeneration) return
      inside.value = contents
    } catch {
      if (mine !== insideGeneration) return
      inside.value = empty()
    } finally {
      if (mine === insideGeneration) {
        insideLoading.value = false
        resetFocus()
      }
    }
  }

  watch(standingAt, (path) => void loadInside(path))

  function standAt(path: string | null): void {
    standingAt.value = path
    clearChoice()
  }

  /**
   * Re-reads whichever folder is currently stood in, without rescanning every
   * declared workspace the way `refresh` does — for a change made to just
   * this one book from outside the tree walk, such as a shelf gesture that
   * reordered or inserted pages.
   */
  function reloadInside(): Promise<void> {
    return loadInside(standingAt.value)
  }

  const crumbs = computed(() =>
    standingAt.value === null
      ? []
      : crumbsFor(
          roots.value.map((node) => node.path),
          standingAt.value,
        ),
  )

  const insideWorkspace = computed<string | null>(() => crumbs.value[0]?.path ?? null)

  const home = computed<DirEntry[]>(() => roots.value.map(entryOf))

  /**
   * The cards come off the disk; the order and what is hidden come from the
   * store that owns the book.
   *
   * ⭐ This is what makes an undo show. `listInside` is a main-process read of
   * a folder and knows nothing of a command that has just run in here, so a
   * shelf laid out straight from it stayed on the order from before the key
   * was pressed while the disk underneath it was already right — which reads
   * exactly like an undo that did nothing. Deriving instead of re-reading also
   * means no gesture has to remember to ask for a rescan afterwards.
   *
   * Falls back to the folder read whole for a book nothing has a handle on
   * yet, and carries a page the order has not heard of at the end, where
   * `reconcilePages` would put it.
   */
  const bandPages = computed<ShelfLeaf[]>(() => {
    const found = inside.value.pages
    const at = standingAt.value
    if (!inside.value.book || at === null) return found
    const order = useBookMetaStore().orderOf(at)
    if (order === null) return found
    const deleted = new Set(order.deletedPages)
    const left = new Map(found.map((leaf) => [leaf.id, leaf]))
    const out: ShelfLeaf[] = []
    for (const id of order.pages) {
      const leaf = left.get(id)
      if (leaf === undefined) continue
      left.delete(id)
      if (!deleted.has(id)) out.push(leaf)
    }
    for (const leaf of found) if (left.has(leaf.id)) out.push(leaf)
    return out
  })
  const bandProjects = computed<DirEntry[]>(() =>
    inside.value.entries.filter((entry) => entry.book),
  )

  const bandFiles = computed<DirEntry[]>(() =>
    inside.value.entries.filter((entry) => !entry.book),
  )

  /**
   * How many bands the shelf draws. The page band counts wherever one is stood
   * in: with no pages it is the empty zone a folder is turned into a book
   * through, which is a band to jump to like any other.
   */
  const bandCount = computed(
    () =>
      [standingAt.value === null ? 0 : 1, bandProjects.value.length, bandFiles.value.length].filter(
        (n) => n > 0,
      ).length,
  )

  /**
   * The project band: the declared workspaces at the root, and below it the
   * folder's own pages followed by the books standing in it. A folder holds
   * both at once — being a book does not stop it from having books filed
   * under it — so the two are one territory laid out in the order the shelf
   * draws them.
   */
  const projectItems = computed<ShelfItem[]>(() => {
    if (standingAt.value === null) return home.value.map(entryItem)
    return [...bandPages.value.map(pageItem), ...bandProjects.value.map(entryItem)]
  })

  /**
   * The file band: whatever lies beside the books or the pages. The root has
   * no such band — every declared workspace is a project, not a file lying
   * loose beside one.
   */
  const fileItems = computed<ShelfItem[]>(() =>
    standingAt.value === null ? [] : bandFiles.value.map(entryItem),
  )

  function itemsOf(region: ShelfRegion): ShelfItem[] {
    return region === 'project' ? projectItems.value : fileItems.value
  }

  function regionOf(key: string): ShelfRegion | null {
    if (projectItems.value.some((item) => item.key === key)) return 'project'
    if (fileItems.value.some((item) => item.key === key)) return 'file'
    return null
  }

  /**
   * Always one of the two, never "wherever the keyboard happens to be": the
   * left column is a list of places to go, not a third region.
   */
  const focus = ref<ShelfRegion>('project')

  function resetFocus(): void {
    focus.value = projectItems.value.length > 0 ? 'project' : 'file'
  }

  const projectChosen = ref<string[]>([])
  /** Where a Shift reach measures its run from, one per band. */
  const projectAnchor = ref<string | null>(null)
  const fileChosen = ref<string[]>([])
  const fileAnchor = ref<string | null>(null)
  /** What the arrow keys are standing on, which need not be selected. */
  const cursor = ref<string | null>(null)

  function chosenOf(region: ShelfRegion) {
    return region === 'project' ? projectChosen : fileChosen
  }

  function anchorOf(region: ShelfRegion) {
    return region === 'project' ? projectAnchor : fileAnchor
  }

  function touch(region: ShelfRegion): void {
    focus.value = region
    const other = region === 'project' ? 'file' : 'project'
    // Guarded rather than unconditional: a marquee drag calls this every
    // frame, and a fresh empty array is still a fresh reference — writing it
    // over an already-empty one would re-trigger every reactive dependent on
    // the untouched band for as long as the drag lasted.
    if (chosenOf(other).value.length > 0) chosenOf(other).value = []
    if (anchorOf(other).value !== null) anchorOf(other).value = null
  }

  const chosenItems = computed<ShelfItem[]>(() => [
    ...projectItems.value.filter((item) => projectChosen.value.includes(item.key)),
    ...fileItems.value.filter((item) => fileChosen.value.includes(item.key)),
  ])
  const chosenKeys = computed(() => new Set(chosenItems.value.map((item) => item.key)))

  function isChosen(key: string): boolean {
    return chosenKeys.value.has(key)
  }

  function only(region: ShelfRegion, key: string): void {
    touch(region)
    chosenOf(region).value = [key]
    anchorOf(region).value = key
    cursor.value = key
  }

  function toggle(region: ShelfRegion, key: string): void {
    touch(region)
    const chosen = chosenOf(region)
    const at = chosen.value.indexOf(key)
    if (at === -1) chosen.value.push(key)
    else chosen.value.splice(at, 1)
    anchorOf(region).value = key
    cursor.value = key
  }

  /** The run from the anchor to here, and nothing else — as a file manager does. Never leaves the band. */
  function extendTo(region: ShelfRegion, key: string): void {
    touch(region)
    const keys = itemsOf(region).map((item) => item.key)
    const anchor = anchorOf(region)
    const from = anchor.value === null ? 0 : keys.indexOf(anchor.value)
    const to = keys.indexOf(key)
    if (from === -1 || to === -1) return only(region, key)
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    chosenOf(region).value = keys.slice(lo, hi + 1)
    cursor.value = key
  }

  /** Whichever band currently holds focus, all of it. */
  function chooseAll(): void {
    chosenOf(focus.value).value = itemsOf(focus.value).map((item) => item.key)
  }

  /** A snapshot a marquee drag can start from and recompute against. */
  function chosenIn(region: ShelfRegion): string[] {
    return [...chosenOf(region).value]
  }

  function sameOrder(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((key, at) => key === b[at])
  }

  /**
   * What a marquee drag replaces a band's selection with, every frame. Band
   * order rather than hit order — a rectangle sweeping the grid touches cards
   * in whatever order its edge happens to cross them in, and that is not a
   * fact about the selection.
   *
   * Guarded the same way `touch` is: most frames of a held drag touch exactly
   * the same cards as the frame before, and writing an equal array over
   * itself would still be a fresh reference.
   */
  function frameSelect(region: ShelfRegion, keys: string[]): void {
    touch(region)
    const ordered = itemsOf(region)
      .map((item) => item.key)
      .filter((key) => keys.includes(key))
    const chosen = chosenOf(region)
    if (!sameOrder(chosen.value, ordered)) chosen.value = ordered
    const anchorKey = ordered[0] ?? null
    const anchor = anchorOf(region)
    if (anchor.value !== anchorKey) anchor.value = anchorKey
    if (cursor.value !== anchorKey) cursor.value = anchorKey
  }

  /** Both bands, since only one is ever non-empty. Focus does not move. */
  function clearChoice(): void {
    projectChosen.value = []
    projectAnchor.value = null
    fileChosen.value = []
    fileAnchor.value = null
    cursor.value = null
  }

  const picked = computed<DirEntry | null>(() => {
    const one = chosenItems.value
    return one.length === 1 && one[0].kind === 'entry' ? one[0].entry : null
  })

  const pickedLeaf = computed<ShelfLeaf | null>(() => {
    const one = chosenItems.value
    return one.length === 1 && one[0].kind === 'page' ? one[0].page : null
  })

  return {
    roots,
    bookTotal,
    scanning,
    standingAt,
    inside,
    insideLoading,
    picked,
    pickedLeaf,
    view,
    crumbs,
    insideWorkspace,
    home,
    bandPages,
    bandProjects,
    bandFiles,
    bandCount,
    projectItems,
    fileItems,
    focus,
    chosenItems,
    cursor,
    isChosen,
    regionOf,
    only,
    toggle,
    extendTo,
    chooseAll,
    clearChoice,
    chosenIn,
    frameSelect,
    refresh,
    addWorkspace,
    removeWorkspace,
    standAt,
    reloadInside,
  }
})
