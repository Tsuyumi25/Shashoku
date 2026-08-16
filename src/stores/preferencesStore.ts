import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { SplitterGroupProps } from 'reka-ui'
import { parsePreferences, serializePreferences } from '@shared/preferences/schema'
import {
  MAX_FONT_SAMPLE_PX,
  MIN_FONT_SAMPLE_PX,
  defaultPreferences,
  type MissingGlyphMode,
  MIN_SECTION_HEIGHT,
  type CandidateSection,
  type SidePanel,
} from '@shared/preferences/types'

const PERSIST_DEBOUNCE_MS = 250

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

  function setFontSamplePx(px: number) {
    if (!Number.isFinite(px)) return
    prefs.fontSamplePx = Math.min(MAX_FONT_SAMPLE_PX, Math.max(MIN_FONT_SAMPLE_PX, Math.round(px)))
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

  function setFontSampleVertical(vertical: boolean) {
    prefs.fontSampleVertical = vertical
  }

  function setMissingGlyphMode(mode: MissingGlyphMode) {
    prefs.missingGlyphMode = mode
  }

  function setMarkMissingGlyphs(on: boolean) {
    prefs.markMissingGlyphs = on
  }

  function setSidePanel(panel: SidePanel) {
    prefs.sidePanel = panel
  }

  function toggleSection(section: CandidateSection) {
    prefs.sectionOpen[section] = !prefs.sectionOpen[section]
  }

  function setSectionHeight(section: CandidateSection, px: number) {
    prefs.sectionHeight[section] = Math.max(MIN_SECTION_HEIGHT, Math.round(px))
  }

  return {
    prefs,
    hydrate,
    flush,
    panelStorage,
    favorites,
    isFavorite,
    toggleFavorite,
    setFontSamplePx,
    setFontSampleText,
    setFontSampleVertical,
    addFontFolder,
    removeFontFolder,
    addScanPoint,
    removeScanPoint,
    setMissingGlyphMode,
    setMarkMissingGlyphs,
    setSidePanel,
    toggleSection,
    setSectionHeight,
  }
})
