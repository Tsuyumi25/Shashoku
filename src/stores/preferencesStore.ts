import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { SplitterGroupProps } from 'reka-ui'
import { parsePreferences, serializePreferences } from '@shared/preferences/schema'
import {
  MAX_FONT_PICKER_BOX_PX,
  MIN_FONT_PICKER_BOX_PX,
  defaultPreferences,
  type MissingGlyphMode,
  type SidePanel,
} from '@shared/preferences/types'
import { chosenDefaultFamily } from '@/lib/fontCatalog'

const PERSIST_DEBOUNCE_MS = 250

/** How many opened projects the library's 最近 page remembers. */
const RECENT_PROJECTS_KEPT = 30

/** reka-ui does not export this type, but it is reachable through the props. */
type PanelGroupStorage = NonNullable<SplitterGroupProps['storage']>

export const usePreferencesStore = defineStore('preferences', () => {
  const prefs = reactive(defaultPreferences())
  const hydrated = ref(false)

  let persistTimer: ReturnType<typeof setTimeout> | undefined

  function persist() {
    return window.api.writePreferences(serializePreferences(prefs)).catch((err: unknown) => {
      console.error('preferences: write failed', err)
    })
  }

  /** Land the debounced write now, for the moment before the window goes. */
  function flush(): Promise<void> {
    clearTimeout(persistTimer)
    return persist()
  }

  watch(
    prefs,
    () => {
      if (!hydrated.value) return
      clearTimeout(persistTimer)
      persistTimer = setTimeout(() => void persist(), PERSIST_DEBOUNCE_MS)
    },
    { deep: true },
  )

  /**
   * Must finish before the app mounts: SplitterGroup reads its stored geometry
   * synchronously during setup, and a late answer shows the default widths for
   * a frame before snapping to the saved ones.
   */
  async function hydrate() {
    let raw = ''
    try {
      raw = await window.api.readPreferences()
    } catch (err) {
      console.error('preferences: read failed, continuing with defaults', err)
    }
    Object.assign(prefs, parsePreferences(raw))
    hydrated.value = true
  }

  const panelStorage: PanelGroupStorage = {
    getItem: (name) => prefs.panelLayout[name] ?? null,
    setItem: (name, value) => {
      prefs.panelLayout[name] = value
    },
  }

  const favorites = computed(() => new Set(prefs.fontFavorites))

  function isFavorite(family: string): boolean {
    return favorites.value.has(family)
  }

  function toggleFavorite(family: string) {
    const at = prefs.fontFavorites.indexOf(family)
    if (at === -1) prefs.fontFavorites.push(family)
    else prefs.fontFavorites.splice(at, 1)
  }

  function setFontPickerBoxPx(px: number) {
    if (!Number.isFinite(px)) return
    prefs.fontPickerBoxPx = Math.min(
      MAX_FONT_PICKER_BOX_PX,
      Math.max(MIN_FONT_PICKER_BOX_PX, Math.round(px)),
    )
  }

  function setFontSampleText(text: string) {
    prefs.fontSampleText = text
  }

  function addFontFolder(path: string): boolean {
    if (!path || prefs.fontFolders.includes(path)) return false
    prefs.fontFolders.push(path)
    return true
  }

  function removeFontFolder(path: string) {
    const at = prefs.fontFolders.indexOf(path)
    if (at !== -1) prefs.fontFolders.splice(at, 1)
  }

  function addScanPoint(path: string): boolean {
    if (!path || prefs.scanPoints.includes(path)) return false
    prefs.scanPoints.push(path)
    return true
  }

  function removeScanPoint(path: string) {
    const at = prefs.scanPoints.indexOf(path)
    if (at !== -1) prefs.scanPoints.splice(at, 1)
  }

  function addWorkspace(path: string): boolean {
    if (!path || prefs.workspaces.includes(path)) return false
    prefs.workspaces.push(path)
    return true
  }

  function removeWorkspace(path: string) {
    const at = prefs.workspaces.indexOf(path)
    if (at !== -1) prefs.workspaces.splice(at, 1)
  }

  function noteRecentProject(path: string) {
    prefs.recentProjects = [path, ...prefs.recentProjects.filter((p) => p !== path)].slice(
      0,
      RECENT_PROJECTS_KEPT,
    )
  }

  function setFontSampleVertical(vertical: boolean) {
    prefs.fontSampleVertical = vertical
  }

  function setDefaultFontFamily(family: string) {
    prefs.defaultFontFamily = family
  }

  /**
   * Handed to the catalogue rather than read from there.
   *
   * The canvas resolves a face on every repaint and cannot reach a store to do
   * it — a Pinia instance between a label and its font would be one more thing
   * that has to exist before anything can be drawn. So the preference is
   * pushed into the module that already holds the faces.
   */
  watch(
    () => prefs.defaultFontFamily,
    (family) => {
      chosenDefaultFamily.value = family
    },
    { immediate: true },
  )

  function setMissingGlyphMode(mode: MissingGlyphMode) {
    prefs.missingGlyphMode = mode
  }

  function setMarkMissingGlyphs(on: boolean) {
    prefs.markMissingGlyphs = on
  }

  function setSidePanel(panel: SidePanel) {
    prefs.sidePanel = panel
  }

  return {
    prefs,
    hydrate,
    flush,
    panelStorage,
    favorites,
    isFavorite,
    toggleFavorite,
    setFontPickerBoxPx,
    setFontSampleText,
    setFontSampleVertical,
    addFontFolder,
    removeFontFolder,
    addScanPoint,
    removeScanPoint,
    addWorkspace,
    removeWorkspace,
    noteRecentProject,
    setDefaultFontFamily,
    setMissingGlyphMode,
    setMarkMissingGlyphs,
    setSidePanel,
  }
})
