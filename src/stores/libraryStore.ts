import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  buildWorkspaceTree,
  crumbsFor,
  type DirEntry,
  type FolderContents,
  type LibraryNode,
  type ShelfLeaf,
} from '@shared/project/workspace'
import { usePreferencesStore } from '@/stores/preferencesStore'

/** Names beside covers, or covers with names under them. */
export type LibraryView = 'list' | 'thumbnail'

/**
 * One card, whichever band drew it. Two kinds sit in one list because a
 * selection reaches across them, while the key keeps them apart: a page is
 * named inside its book, a file by where it lies.
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
      if (mine === insideGeneration) insideLoading.value = false
    }
  }

  watch(standingAt, (path) => void loadInside(path))

  function standAt(path: string | null): void {
    standingAt.value = path
    clearChoice()
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

  const bandPages = computed<ShelfLeaf[]>(() => inside.value.pages)
  const bandProjects = computed<DirEntry[]>(() =>
    inside.value.book ? [] : inside.value.entries.filter((entry) => entry.book),
  )

  const bandFiles = computed<DirEntry[]>(() =>
    inside.value.entries.filter((entry) => !entry.book),
  )

  const bandCount = computed(
    () =>
      [bandPages.value.length, bandProjects.value.length, bandFiles.value.length].filter(
        (n) => n > 0,
      ).length,
  )

  /**
   * Every card on the shelf, in the order they are read. A range runs along
   * this list and not along any one band, because a drag does not stop at a
   * heading and neither does Shift.
   */
  const items = computed<ShelfItem[]>(() => {
    if (standingAt.value === null) return home.value.map(entryItem)
    return [
      ...bandPages.value.map(pageItem),
      ...bandProjects.value.map(entryItem),
      ...bandFiles.value.map(entryItem),
    ]
  })

  const chosen = ref<string[]>([])
  /** Where a Shift reach measures its run from. */
  const anchor = ref<string | null>(null)
  /** What the arrow keys are standing on, which need not be selected. */
  const cursor = ref<string | null>(null)

  const chosenKeys = computed(() => new Set(chosen.value))
  const chosenItems = computed(() => items.value.filter((item) => chosenKeys.value.has(item.key)))

  function isChosen(key: string): boolean {
    return chosenKeys.value.has(key)
  }

  function only(key: string): void {
    chosen.value = [key]
    anchor.value = key
    cursor.value = key
  }

  function toggle(key: string): void {
    const at = chosen.value.indexOf(key)
    if (at === -1) chosen.value.push(key)
    else chosen.value.splice(at, 1)
    anchor.value = key
    cursor.value = key
  }

  /** The run from the anchor to here, and nothing else — as a file manager does. */
  function extendTo(key: string): void {
    const keys = items.value.map((item) => item.key)
    const from = anchor.value === null ? 0 : keys.indexOf(anchor.value)
    const to = keys.indexOf(key)
    if (from === -1 || to === -1) return only(key)
    const [lo, hi] = from <= to ? [from, to] : [to, from]
    chosen.value = keys.slice(lo, hi + 1)
    cursor.value = key
  }

  function chooseAll(): void {
    chosen.value = items.value.map((item) => item.key)
  }

  function clearChoice(): void {
    chosen.value = []
    anchor.value = null
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
    items,
    chosen,
    chosenItems,
    cursor,
    isChosen,
    only,
    toggle,
    extendTo,
    chooseAll,
    clearChoice,
    refresh,
    addWorkspace,
    removeWorkspace,
    standAt,
  }
})
