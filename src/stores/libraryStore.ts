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

  const picked = ref<DirEntry | null>(null)
  const pickedLeaf = ref<ShelfLeaf | null>(null)

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
    picked.value = null
    pickedLeaf.value = null
  }

  function pickEntry(entry: DirEntry): void {
    picked.value = entry
    pickedLeaf.value = null
  }

  function pickLeaf(leaf: ShelfLeaf): void {
    pickedLeaf.value = leaf
    picked.value = null
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
    refresh,
    addWorkspace,
    removeWorkspace,
    standAt,
    pickEntry,
    pickLeaf,
  }
})
