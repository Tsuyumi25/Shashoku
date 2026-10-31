import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { SplitterGroupProps } from 'reka-ui'
import {
  clampUiZoomLevel,
  parsePreferences,
  serializePreferences,
} from '@shared/preferences/schema'
import {
  MAX_FONT_PICKER_BOX_PX,
  MIN_FONT_PICKER_BOX_PX,
  defaultPreferences,
  type MissingGlyphMode,
  type SidePanel,
} from '@shared/preferences/types'
import { freeGroupName } from '@shared/preferences/fontGroups'
import { cloneEffects } from '@shared/effects/clone'
import type { LayerEffect } from '@shared/effects/types'
import { normalPicks, sameMaterial, type MaterialField } from '@shared/preferences/materials'
import type { TextStyle } from '@shared/text-style/types'
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
    // Watched from here so the level read from disk takes effect the same way
    // one pressed does, and only in a window that read one.
    watch(
      () => prefs.uiZoomLevel,
      (level) => window.api.setZoomLevel(level),
      { immediate: true },
    )
  }

  function setUiZoomLevel(level: number) {
    prefs.uiZoomLevel = clampUiZoomLevel(level)
  }

  /** One step larger or smaller; 0 puts it back as built. */
  function zoomUi(step: 1 | -1 | 0) {
    setUiZoomLevel(step === 0 ? 0 : prefs.uiZoomLevel + step)
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

  function createMaterialGroup(name: string): string {
    const id = crypto.randomUUID()
    prefs.materialGroups.push({
      id,
      name: freeGroupName(name, prefs.materialGroups.map((g) => g.name)),
      materials: [],
    })
    return id
  }

  /** False when another group already goes by the name; nothing changes then. */
  function renameMaterialGroup(id: string, name: string): boolean {
    if (prefs.materialGroups.some((g) => g.id !== id && g.name === name)) return false
    const group = prefs.materialGroups.find((g) => g.id === id)
    if (!group) return false
    group.name = name
    return true
  }

  function deleteMaterialGroup(id: string) {
    const at = prefs.materialGroups.findIndex((g) => g.id === id)
    if (at !== -1) prefs.materialGroups.splice(at, 1)
  }

  /** False when the group already holds the same snapshot ticked the same way; nothing changes then. */
  function saveMaterial(
    groupId: string,
    snapshot: { text: string; style: TextStyle; effects: readonly LayerEffect[] },
    picks: readonly MaterialField[],
  ): boolean {
    const group = prefs.materialGroups.find((g) => g.id === groupId)
    if (!group) return false
    const material = {
      text: snapshot.text,
      style: { ...snapshot.style },
      effects: cloneEffects(snapshot.effects),
      picks: normalPicks(picks),
    }
    if (group.materials.some((m) => sameMaterial(m, material))) return false
    group.materials.push({ id: crypto.randomUUID(), ...material })
    return true
  }

  function deleteMaterial(groupId: string, id: string) {
    const group = prefs.materialGroups.find((g) => g.id === groupId)
    if (group) group.materials = group.materials.filter((m) => m.id !== id)
  }

  function toggleMaterialPick(groupId: string, id: string, field: MaterialField) {
    const material = prefs.materialGroups.find((g) => g.id === groupId)?.materials.find((m) => m.id === id)
    if (!material) return
    const on = material.picks.includes(field)
    material.picks = normalPicks(on ? material.picks.filter((p) => p !== field) : [...material.picks, field])
  }

  function createRecipe(name: string): string {
    const id = crypto.randomUUID()
    prefs.materialRecipes.push({ id, name: freeGroupName(name, prefs.materialRecipes.map((r) => r.name)), picks: [] })
    return id
  }

  /** False when another recipe already goes by the name; nothing changes then. */
  function renameRecipe(id: string, name: string): boolean {
    if (prefs.materialRecipes.some((r) => r.id !== id && r.name === name)) return false
    const recipe = prefs.materialRecipes.find((r) => r.id === id)
    if (!recipe) return false
    recipe.name = name
    return true
  }

  function deleteRecipe(id: string) {
    prefs.materialRecipes = prefs.materialRecipes.filter((r) => r.id !== id)
  }

  function toggleRecipePick(id: string, field: MaterialField) {
    const recipe = prefs.materialRecipes.find((r) => r.id === id)
    if (!recipe) return
    const on = recipe.picks.includes(field)
    recipe.picks = normalPicks(on ? recipe.picks.filter((p) => p !== field) : [...recipe.picks, field])
  }

  function createFontGroup(name: string): string {
    const id = crypto.randomUUID()
    prefs.fontGroups.push({ id, name: freeGroupName(name, prefs.fontGroups.map((g) => g.name)), families: [] })
    return id
  }

  /** False when another group already goes by the name; nothing changes then. */
  function renameFontGroup(id: string, name: string): boolean {
    if (prefs.fontGroups.some((g) => g.id !== id && g.name === name)) return false
    const group = prefs.fontGroups.find((g) => g.id === id)
    if (!group) return false
    group.name = name
    return true
  }

  function deleteFontGroup(id: string) {
    const at = prefs.fontGroups.findIndex((g) => g.id === id)
    if (at !== -1) prefs.fontGroups.splice(at, 1)
  }

  function toggleFamilyInGroup(id: string, family: string) {
    const group = prefs.fontGroups.find((g) => g.id === id)
    if (!group) return
    const at = group.families.indexOf(family)
    if (at === -1) group.families.push(family)
    else group.families.splice(at, 1)
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
    zoomUi,
    setUiZoomLevel,
    flush,
    panelStorage,
    favorites,
    isFavorite,
    toggleFavorite,
    createMaterialGroup,
    renameMaterialGroup,
    deleteMaterialGroup,
    saveMaterial,
    deleteMaterial,
    toggleMaterialPick,
    createRecipe,
    renameRecipe,
    deleteRecipe,
    toggleRecipePick,
    createFontGroup,
    renameFontGroup,
    deleteFontGroup,
    toggleFamilyInGroup,
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
