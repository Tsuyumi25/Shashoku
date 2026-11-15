import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { folderName } from '@shared/project/library'
import { favoriteCards, healedMembers, missingCard, type Favorite } from '@shared/project/favorites'
import type { ProjectCard } from '@shared/project/workspace'
import { useNoticeStore } from '@/stores/noticeStore'
import { usePreferencesStore } from '@/stores/preferencesStore'

/** Names beside covers, or covers with names under them. */
export type LibraryView = 'list' | 'thumbnail'

/** Where the shelf's cards come from. */
export type LibrarySource =
  | { kind: 'recent' }
  | { kind: 'all' }
  | { kind: 'favorite'; id: string }
  | { kind: 'workspace'; path: string }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function byName(cards: readonly ProjectCard[]): ProjectCard[] {
  return [...cards].sort((a, b) => collator.compare(a.name, b.name))
}

function belongs(favorite: Favorite, card: ProjectCard): boolean {
  return favorite.members.some((m) => m.path === card.path || (card.id !== null && m.projectId === card.id))
}

export const useLibraryStore = defineStore('library', () => {
  const preferences = usePreferencesStore()

  /** The app opens on 最近: what was worked on last is what is most often picked up again. */
  const source = ref<LibrarySource>({ kind: 'recent' })
  const view = ref<LibraryView>('thumbnail')
  const scanning = ref(false)
  /** Each declared workspace, keyed as the preferences spell it, with the projects found under it. */
  const scanned = ref(new Map<string, ProjectCard[]>())
  /** Every path the library remembers by name — 全部 and the 收藏夾 members — read where it stands. */
  const known = ref(new Map<string, ProjectCard>())
  const selectedPath = ref<string | null>(null)

  /** Every project the last refresh met, wherever it met it: what an id is looked for in. */
  const seen = computed<ProjectCard[]>(() => [...[...scanned.value.values()].flat(), ...known.value.values()])

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
      do {
        queued = false
        scanning.value = true
        try {
          await scanOnce()
        } finally {
          scanning.value = false
        }
      } while (queued)
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function scanOnce(): Promise<void> {
    // Copied out of the store: structured clone refuses a reactive Proxy.
    const workspaces = [...preferences.prefs.workspaces]
    const named = [
      ...new Set([
        ...preferences.prefs.recentProjects,
        ...preferences.prefs.favorites.flatMap((f) => f.members.map((m) => m.path)),
      ]),
    ]
    const [scans, cards] = await Promise.all([
      Promise.all(workspaces.map((path) => window.api.scanWorkspaces([path]))),
      window.api.describeProjects(named),
    ])
    scanned.value = new Map(workspaces.map((path, at) => [path, byName(scans[at]?.roots[0]?.projects ?? [])]))
    known.value = new Map(cards.map((card) => [card.path, card]))
    for (const favorite of preferences.prefs.favorites) {
      const healed = healedMembers(favorite, known.value, seen.value)
      if (healed) preferences.setFavoriteMembers(favorite.id, healed)
    }
  }

  const recentCards = computed(() =>
    preferences.prefs.recentProjects.map((path) => known.value.get(path) ?? missingCard(path, null)),
  )

  function favoriteOf(id: string): Favorite | undefined {
    return preferences.prefs.favorites.find((f) => f.id === id)
  }

  function cardsOf(from: LibrarySource): ProjectCard[] {
    switch (from.kind) {
      case 'recent':
        return recentCards.value
      case 'all':
        return byName(recentCards.value)
      case 'favorite': {
        const favorite = favoriteOf(from.id)
        return favorite ? favoriteCards(favorite, known.value, seen.value) : []
      }
      case 'workspace':
        return scanned.value.get(from.path) ?? []
    }
  }

  const cards = computed(() => cardsOf(source.value))

  const title = computed(() => {
    const from = source.value
    switch (from.kind) {
      case 'recent':
        return '最近'
      case 'all':
        return '全部'
      case 'favorite':
        return favoriteOf(from.id)?.name ?? ''
      case 'workspace':
        return folderName(from.path)
    }
  })

  const selected = computed(() => cards.value.find((card) => card.path === selectedPath.value) ?? null)

  function show(from: LibrarySource): void {
    source.value = from
    selectedPath.value = null
  }

  function isShowing(from: LibrarySource): boolean {
    const now = source.value
    if (now.kind !== from.kind) return false
    if (now.kind === 'favorite' && from.kind === 'favorite') return now.id === from.id
    if (now.kind === 'workspace' && from.kind === 'workspace') return now.path === from.path
    return true
  }

  function select(path: string | null): void {
    selectedPath.value = path
  }

  async function addWorkspace(): Promise<boolean> {
    const path = await window.api.pickWorkspace()
    if (path === null) return false
    if (!preferences.addWorkspace(path)) return false
    await refresh()
    return true
  }

  async function removeWorkspace(path: string): Promise<void> {
    preferences.removeWorkspace(path)
    if (isShowing({ kind: 'workspace', path })) show({ kind: 'recent' })
    await refresh()
  }

  function createFavorite(): string {
    return preferences.addFavorite('新收藏夾')
  }

  function deleteFavorite(id: string): void {
    if (isShowing({ kind: 'favorite', id })) show({ kind: 'recent' })
    preferences.removeFavorite(id)
  }

  function inFavorite(id: string, card: ProjectCard): boolean {
    const favorite = favoriteOf(id)
    return favorite !== undefined && belongs(favorite, card)
  }

  function toggleFavorite(id: string, card: ProjectCard): void {
    const favorite = favoriteOf(id)
    if (!favorite) return
    preferences.setFavoriteMembers(
      id,
      belongs(favorite, card)
        ? favorite.members.filter((m) => m.path !== card.path && (card.id === null || m.projectId !== card.id))
        : [...favorite.members, { path: card.path, projectId: card.id }],
    )
  }

  /** Into a 收藏夾 by path alone, for a folder dropped on its row. */
  async function addPathToFavorite(id: string, path: string): Promise<void> {
    const [card] = await window.api.describeProjects([path])
    if (!card?.found || inFavorite(id, card)) return
    known.value = new Map(known.value).set(card.path, card)
    toggleFavorite(id, card)
  }

  /** Points a missing member at a folder the user picks, which has to be a project. */
  async function relink(id: string, card: ProjectCard): Promise<void> {
    const favorite = favoriteOf(id)
    if (!favorite) return
    const path = await window.api.pickRoot()
    if (path === null) return
    const [picked] = await window.api.describeProjects([path])
    if (!picked?.found) {
      useNoticeStore().say('這個資料夾不是專案')
      return
    }
    known.value = new Map(known.value).set(picked.path, picked)
    preferences.setFavoriteMembers(
      id,
      favorite.members.map((m) =>
        m.path === card.path ? { path: picked.path, projectId: picked.id ?? m.projectId } : m,
      ),
    )
  }

  /** Into 全部 and 最近 by path alone, for a project folder dropped on the library. */
  async function remember(path: string): Promise<void> {
    preferences.noteRecentProject(path)
    await refresh()
  }

  return {
    source,
    view,
    scanning,
    cards,
    title,
    selected,
    cardsOf,
    show,
    isShowing,
    select,
    refresh,
    addWorkspace,
    removeWorkspace,
    createFavorite,
    deleteFavorite,
    inFavorite,
    toggleFavorite,
    addPathToFavorite,
    relink,
    remember,
  }
})
