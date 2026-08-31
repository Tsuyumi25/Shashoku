import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  booksUnder,
  buildWorkspaceTree,
  nodeAt,
  trailTo,
  type BookNode,
  type FolderNode,
  type LibraryNode,
  type ShelfLeaf,
} from '@shared/project/workspace'
import { usePreferencesStore } from '@/stores/preferencesStore'

/** Names beside covers, or covers with names under them. */
export type LibraryView = 'list' | 'thumbnail'

/**
 * Held rather than computed because producing it means walking the disk, and it
 * is the disk — not anything stored here — that decides what a workspace holds.
 */
export const useLibraryStore = defineStore('library', () => {
  const roots = ref<LibraryNode[]>([])
  const scanning = ref(false)

  const standingAt = ref<string | null>(null)
  const picked = ref<string | null>(null)
  const pickedLeaf = ref<ShelfLeaf | null>(null)

  const inside = ref<ShelfLeaf[]>([])
  const insideLoading = ref(false)
  const view = ref<LibraryView>('thumbnail')
  const deep = ref(false)

  let inFlight: Promise<void> | null = null
  let queued = false

  /**
   * Coalesced: the tree and the shelf mount together on a cold start, and one
   * walk of the disk serves both. A request arriving mid-scan queues one more
   * pass instead of joining silently — its workspaces may not have existed when
   * the running scan set out.
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
      if (standingAt.value !== null && trailTo(roots.value, standingAt.value).length === 0) {
        standingAt.value = null
      }
      if (picked.value !== null && nodeAt(roots.value, picked.value) === null) {
        picked.value = null
      }
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
    await refresh()
  }

  /** Which load the pending work belongs to, so a stale one cannot land. */
  let insideGeneration = 0

  async function loadInside(path: string | null): Promise<void> {
    const mine = ++insideGeneration
    if (path === null) {
      inside.value = []
      insideLoading.value = false
      return
    }
    insideLoading.value = true
    try {
      const leaves = await window.api.listInside(path)
      if (mine !== insideGeneration) return
      inside.value = leaves
    } catch {
      if (mine !== insideGeneration) return
      inside.value = []
    } finally {
      if (mine === insideGeneration) insideLoading.value = false
    }
  }

  watch(standingAt, (path) => void loadInside(path))

  function standAt(path: string | null): void {
    standingAt.value = path
    pickedLeaf.value = null
  }

  function pick(path: string | null): void {
    picked.value = path
    pickedLeaf.value = null
  }

  function pickLeaf(leaf: ShelfLeaf): void {
    pickedLeaf.value = leaf
    picked.value = null
  }

  const trail = computed<LibraryNode[]>(() =>
    standingAt.value === null ? [] : trailTo(roots.value, standingAt.value),
  )

  const standing = computed<LibraryNode | null>(() => trail.value.at(-1) ?? null)

  const canReachDeep = computed(() => standing.value?.kind === 'folder')

  const shown = computed<LibraryNode[]>(() => {
    const here = standing.value
    if (here === null) return roots.value
    if (here.kind !== 'folder') return []
    return deep.value ? booksUnder(here) : here.children
  })

  const shownBooks = computed<BookNode[]>(
    () => shown.value.filter((node): node is BookNode => node.kind === 'book'),
  )

  const shownFolders = computed<FolderNode[]>(
    () => shown.value.filter((node): node is FolderNode => node.kind === 'folder'),
  )

  const insideWorkspace = computed<string | null>(() => trail.value[0]?.path ?? null)

  const pickedNode = computed<LibraryNode | null>(() =>
    picked.value === null ? null : nodeAt(roots.value, picked.value),
  )

  return {
    roots,
    scanning,
    standingAt,
    picked,
    pickedLeaf,
    inside,
    insideLoading,
    view,
    deep,
    trail,
    standing,
    canReachDeep,
    shown,
    shownBooks,
    shownFolders,
    insideWorkspace,
    pickedNode,
    refresh,
    addWorkspace,
    removeWorkspace,
    standAt,
    pick,
    pickLeaf,
  }
})
