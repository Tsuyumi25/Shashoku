import { ref } from 'vue'
import { defineStore } from 'pinia'
import { buildLibrary, type LibraryEntry } from '@shared/project/library'
import { SHASHOKU_DIR, DIR_RAWS } from '@shared/ssk/constants'
import { usePreferencesStore } from '@/stores/preferencesStore'

/** Where a project keeps the raws it does not depend on the root folder for. */
export function rawsDirOf(projectPath: string): string {
  return `${projectPath}/${SHASHOKU_DIR}/${DIR_RAWS}`
}

/** Names beside covers, or covers with names under them. */
export type LibraryView = 'list' | 'thumbnail'

/**
 * The sidebar's contents. Held rather than computed because producing it means
 * touching the disk, and it is the disk — not anything stored here — that
 * decides what a scan point contains.
 */
export const useLibraryStore = defineStore('library', () => {
  const entries = ref<LibraryEntry[]>([])
  const scanning = ref(false)
  /** Series the user has opened, by scan point path. */
  const expanded = ref<string[]>([])
  const view = ref<LibraryView>('list')

  async function refresh(): Promise<void> {
    const preferences = usePreferencesStore()
    scanning.value = true
    try {
      // Copied out of the store: structured clone refuses a reactive Proxy,
      // and says only that an object could not be cloned when it meets one.
      const scanned = await window.api.scanLibrary([...preferences.prefs.scanPoints])
      entries.value = buildLibrary(scanned)
    } finally {
      scanning.value = false
    }
  }

  /**
   * Drops a folder from the list without touching what is in it. Scan points
   * are recorded by opening a project, so this is how one stops being watched.
   */
  function forgetScanPoint(path: string): void {
    usePreferencesStore().removeScanPoint(path)
    void refresh()
  }

  function toggleExpanded(path: string): void {
    const at = expanded.value.indexOf(path)
    if (at === -1) expanded.value.push(path)
    else expanded.value.splice(at, 1)
  }

  function isExpanded(path: string): boolean {
    return expanded.value.includes(path)
  }

  return {
    entries,
    scanning,
    expanded,
    view,
    refresh,
    forgetScanPoint,
    toggleExpanded,
    isExpanded,
  }
})
