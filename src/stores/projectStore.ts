import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ProjectFile, ProjectHeader } from '@/types/project'
import type { ProjectJson, StyleGroup } from '@shared/project/types'
import type { GroupLayerEntry, LayerEntry, TextLayerEntry } from '@shared/page/types'
import { PASS_THROUGH } from '@shared/page/types'
import {
  defaultColorForGroupIndex,
  defaultProjectJson,
  parseProjectJson,
  serializeProjectJson,
} from '@shared/project/schema'
import { defaultManifest, parseManifest, serializeManifest } from '@shared/page/schema'
import { repairPage } from '@shared/page/repair'
import {
  dissolveGroupAt,
  findEntry,
  findTextObject,
  insertAtPath,
  moveEntry,
  pathOf,
  removeAtPath,
  restoreGroupAt,
  textObjects,
  textObjectsInReadingOrder,
  type DropTarget,
} from '@shared/page/tree'
import { linesOf } from '@shared/page/text'
import { previewImport, type ImportDiff } from '@shared/project/import'
import { parentFolder } from '@shared/project/library'
import { assertDistinctFolders } from '@shared/export/profile'
import type { ExportProfile } from '@shared/export/types'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { DIR_RAWS, SHASHOKU_DIR, layersDirOf } from '@shared/ssk/constants'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { createAutosave } from '@/lib/autosave'

function generateGroupId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `grp-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}


/**
 * Where a text object sits, in both senses at once: its place in the tree,
 * which is stacking order, and its place in the reading order. Undo has to put
 * a deleted object back into both, and neither can be worked out from the other.
 */
export interface LabelPlace {
  path: number[]
  orderIndex: number
}


/**
 * One entry taken off a page, with everything needed to put it back.
 *
 * A folder carries its whole subtree, so removing one takes text objects out
 * of the reading order that were never named directly. Their places are read
 * off the sequence before anything moves — working them out afterwards is
 * impossible, since each removal shifts the ones behind it.
 */
export interface RemovedEntry {
  filename: string
  path: number[]
  entry: LayerEntry
  order: Array<{ id: string; index: number }>
}


function shashokuDirOf(rootPath: string): string {
  return joinPath(rootPath, SHASHOKU_DIR)
}
function joinPath(...parts: string[]): string {
  
  return parts.filter(Boolean).join('/')
}


export const useProjectStore = defineStore('project', () => {
  const rootPath = ref<string | null>(null)
  const projectMeta = ref<ProjectJson>(defaultProjectJson())
  const files = ref<ProjectFile[]>([])
  const metaDirty = ref(false)
  
  const dirtyFilenames = ref<string[]>([])

  const isOpen = computed(() => rootPath.value !== null)
  const folderPath = computed(() => rootPath.value)
  const header = computed<ProjectHeader>(() => ({
    groups: projectMeta.value.groups,
    defaultStyle: projectMeta.value.defaultStyle,
    comment: projectMeta.value.comment,
  }))
  const dirty = computed(() => metaDirty.value || dirtyFilenames.value.length > 0)
  
  const rawsDir = computed(() =>
    rootPath.value === null ? null : joinPath(rootPath.value, SHASHOKU_DIR, DIR_RAWS),
  )
  
  const shashokuDir = computed(() =>
    rootPath.value === null ? null : joinPath(rootPath.value, SHASHOKU_DIR),
  )
  function fileByName(filename: string): ProjectFile | undefined {
    return files.value.find((f) => f.filename === filename)
  }

  /**
   * Deliberately not rescheduled after a failure: a disk that is gone stays
   * gone, and retrying on a timer would turn one broken write into a loop. The
   * work stays queued for the next edit or the next flush.
   */
  const autosave = createAutosave(save, {
    onError: (err) => console.error('autosave failed', err),
  })

  /**
   * Every mutation below ends here or in markMetaDirty, which is what lets the
   * autosave be scheduled in two places rather than at each of the twenty-odd
   * call sites — and what keeps a new mutation from silently opting out of it.
   */
  function markPageDirty(filename: string) {
    if (!dirtyFilenames.value.includes(filename)) dirtyFilenames.value.push(filename)
    autosave.mark()
  }

  function markMetaDirty() {
    metaDirty.value = true
    autosave.mark()
  }

  function reset() {
    autosave.cancel()
    rootPath.value = null
    projectMeta.value = defaultProjectJson()
    files.value = []
    metaDirty.value = false
    dirtyFilenames.value = []
  }


  async function ingestProject(newRootPath: string, projectMetaRaw: string, pages: Array<{
    filename: string
    pageDir: string
    badge: 'ok' | 'raw-missing' | 'page-missing' | 'damaged'
  }>): Promise<void> {
    // The only place the open project is replaced, so the only place the
    // outgoing one has to be banked. Still addressed by the old rootPath here,
    // which is what makes it land where it came from.
    await autosave.flush()
    const meta = parseProjectJson(projectMetaRaw)
    const groupIds = meta.groups.map((g) => g.id)
    const loaded: ProjectFile[] = []
    // A page whose reading order had drifted is put right here and queued to be
    // written back, so the fix is made once rather than recomputed every open.
    const mended: string[] = []
    for (const p of pages) {
      let page = defaultManifest()
      try {
        const raw = await window.api.readPage(p.pageDir)
        const repair = repairPage(parseManifest(raw.manifestRaw, groupIds))
        page = repair.manifest
        if (repair.repaired.length > 0) mended.push(p.filename)
      } catch {
        // Opens empty rather than taking the whole project down. The page
        // already carries a badge saying its manifest could not be read.
      }
      loaded.push({ filename: p.filename, pageDir: p.pageDir, page, badge: p.badge })
    }
    rootPath.value = newRootPath
    projectMeta.value = meta
    files.value = loaded
    metaDirty.value = false
    dirtyFilenames.value = []
    for (const filename of mended) markPageDirty(filename)
    // Opening a project is also how its neighbours get found: the folder it
    // sits in becomes somewhere the library looks from now on.
    usePreferencesStore().addScanPoint(parentFolder(newRootPath))
  }

  
  async function createNewProject(): Promise<string | null> {
    const picked = await window.api.pickRoot()
    if (picked === null) return null
    const scan = await window.api.scanRoot(picked)
    if (scan.hasShashokuDir) {
      throw new Error(`此資料夾已含 ${SHASHOKU_DIR}/,請改用「開啟」`)
    }
    const result = await window.api.createProject(picked)
    await ingestProject(picked, result.projectMetaRaw, result.pages)
    return picked
  }

  
  async function openExisting(): Promise<string | null> {
    const picked = await window.api.pickRoot()
    if (picked === null) return null
    const scan = await window.api.scanRoot(picked)
    if (!scan.hasShashokuDir || !scan.hasSentinel) {
      throw new Error(`此資料夾不是 Shashoku 專案(缺 ${SHASHOKU_DIR}/ 或 sentinel)`)
    }
    const result = await window.api.openProject(picked)
    await ingestProject(picked, result.projectMetaRaw, result.pages)
    return picked
  }


  async function previewRescanImport(): Promise<ImportDiff | null> {
    if (rootPath.value === null) return null
    const scan = await window.api.scanRoot(rootPath.value)
    
    
    const rawImages = files.value
      .filter((f) => f.badge !== 'raw-missing')
      .map((f) => f.filename)
    return previewImport(scan.rootImages, rawImages)
  }

  
  async function commitRescanImport(filenames: string[]): Promise<void> {
    if (rootPath.value === null) return
    const result = await window.api.importPages(rootPath.value, filenames)
    await ingestProject(rootPath.value, result.projectMetaRaw, result.pages)
  }

  
  async function openByPath(rootPathToOpen: string): Promise<string | null> {
    const scan = await window.api.scanRoot(rootPathToOpen)
    if (!scan.hasShashokuDir || !scan.hasSentinel) return null
    const result = await window.api.openProject(rootPathToOpen)
    await ingestProject(rootPathToOpen, result.projectMetaRaw, result.pages)
    return rootPathToOpen
  }

  /**
   * The flags are taken and cleared before the first await, so an edit made
   * while the write is out marks the page again and earns the next write
   * instead of being cleared along with the one that predated it. A failure
   * puts them back, which both keeps the data queued and lights the title's
   * unsaved marker — under autosave that marker means "not on disk", and this
   * is the only way it stays on.
   */
  async function save(): Promise<void> {
    const root = rootPath.value
    if (root === null || !dirty.value) return

    const pages = dirtyFilenames.value
    const metaWasDirty = metaDirty.value
    dirtyFilenames.value = []
    metaDirty.value = false

    try {
      for (const filename of pages) {
        const file = fileByName(filename)
        if (!file) continue
        await window.api.writePage(file.pageDir, {
          manifestRaw: serializeManifest(file.page),
        })
      }
      if (metaWasDirty) {
        await window.api.writeProjectMeta(
          shashokuDirOf(root),
          serializeProjectJson(projectMeta.value),
        )
      }
    } catch (err) {
      for (const filename of pages) {
        if (!dirtyFilenames.value.includes(filename)) dirtyFilenames.value.push(filename)
      }
      if (metaWasDirty) metaDirty.value = true
      throw err
    }
  }



  /** A page's text objects as a reader meets them — the label list's order. */
  function labelsOf(filename: string): TextLayerEntry[] {
    const file = fileByName(filename)
    return file ? textObjectsInReadingOrder(file.page) : []
  }

  function labelById(filename: string, labelId: string): TextLayerEntry | undefined {
    const file = fileByName(filename)
    return file ? findTextObject(file.page.layers, labelId) : undefined
  }

  /**
   * Without a place, an object joins the end of both orders: the end of the
   * tree because that is what a new object stacks on top of, and the end of the
   * reading order because inserting near the pointer would renumber the page
   * under whoever is reading it.
   */
  function addLabel(filename: string, label: TextLayerEntry, at?: LabelPlace) {
    const file = fileByName(filename)
    if (!file) return
    const place = at ?? {
      path: [file.page.layers.length],
      orderIndex: file.page.readingOrder.length,
    }
    // The tree can have changed shape since the place was taken — a folder the
    // path went through may be gone. Landing on top beats losing the object.
    if (!insertAtPath(file.page.layers, place.path, label)) file.page.layers.push(label)
    const orderIndex = Math.min(Math.max(place.orderIndex, 0), file.page.readingOrder.length)
    file.page.readingOrder.splice(orderIndex, 0, label.id)
    markPageDirty(filename)
  }

  function deleteLabel(filename: string, labelId: string): LabelPlace | null {
    const file = fileByName(filename)
    if (!file) return null
    const path = pathOf(file.page.layers, labelId)
    if (path === null || removeAtPath(file.page.layers, path) === null) return null
    const found = file.page.readingOrder.indexOf(labelId)
    const orderIndex = found === -1 ? file.page.readingOrder.length : found
    if (found !== -1) file.page.readingOrder.splice(found, 1)
    markPageDirty(filename)
    return { path, orderIndex }
  }

  /**
   * Any entry, not only a text object: hiding a folder is how a whole run of
   * them goes away at once.
   */
  function setLayerVisible(filename: string, layerId: string, visible: boolean) {
    const file = fileByName(filename)
    if (!file) return
    const entry = findEntry(file.page.layers, layerId)
    if (!entry || entry.visible === visible) return
    entry.visible = visible
    markPageDirty(filename)
  }

  /**
   * A folder or a raster only.
   *
   * A text object has no name to change: the tree and the label list are two
   * views of the same object, and a name anyone could edit would let one object
   * read differently in each. A raster is the opposite case — its content is
   * pixels, which read as nothing, so 「塗白」 carries real information.
   */
  function renameLayer(filename: string, layerId: string, name: string): boolean {
    const file = fileByName(filename)
    if (!file) return false
    const entry = findEntry(file.page.layers, layerId)
    if (!entry || entry.kind === 'text' || entry.name === name) return false
    entry.name = name
    markPageDirty(filename)
    return true
  }

  /**
   * Where a raster layer's pixels sit and which file they are in.
   *
   * The frame is rounded here rather than trusted from the caller because the
   * manifest refuses a fractional one outright, and every mutation reaches the
   * autosave — one fractional write mid-gesture would leave a project that no
   * longer opens.
   */
  function placeLayer(
    filename: string,
    layerId: string,
    at: { file: string; x: number; y: number; w: number; h: number },
  ) {
    const file = fileByName(filename)
    if (!file) return
    const entry = findEntry(file.page.layers, layerId)
    if (!entry || entry.kind !== 'raster') return
    entry.file = at.file
    entry.x = Math.round(at.x)
    entry.y = Math.round(at.y)
    entry.w = Math.round(at.w)
    entry.h = Math.round(at.h)
    markPageDirty(filename)
  }

  function setLayerLocked(filename: string, layerId: string, locked: boolean) {
    const file = fileByName(filename)
    if (!file) return
    const entry = findEntry(file.page.layers, layerId)
    if (!entry || entry.locked === locked) return
    entry.locked = locked
    markPageDirty(filename)
  }

  /** Any entry too — a folder carries blending so a run can be faded as one. */
  function setLayerOpacity(filename: string, layerId: string, opacity: number) {
    const file = fileByName(filename)
    if (!file) return
    const entry = findEntry(file.page.layers, layerId)
    if (!entry || entry.opacity === opacity) return
    entry.opacity = opacity
    markPageDirty(filename)
  }

  /**
   * Refused rather than corrected for a mode the entry cannot mean:
   * pass-through says "no buffer of my own", and only a container has one to
   * decline. Letting it through would write a manifest that will not parse.
   */
  function setLayerBlendMode(filename: string, layerId: string, blendMode: string): boolean {
    const file = fileByName(filename)
    if (!file) return false
    const entry = findEntry(file.page.layers, layerId)
    if (!entry || entry.blendMode === blendMode) return false
    if (blendMode === PASS_THROUGH && entry.kind !== 'group') return false
    entry.blendMode = blendMode
    markPageDirty(filename)
    return true
  }

  /**
   * A layer joins the page on top, which is where anything new belongs; a path
   * is how undo puts one back exactly where it was. A folder arrives empty and
   * is filed into afterwards.
   *
   * Unlike `addLabel` this touches no reading order — a folder and a raster are
   * not things a reader meets.
   */
  function addLayer(filename: string, entry: LayerEntry, path?: number[]) {
    const file = fileByName(filename)
    if (!file) return
    const at = path ?? [file.page.layers.length]
    if (!insertAtPath(file.page.layers, at, entry)) file.page.layers.push(entry)
    markPageDirty(filename)
  }

  function dissolveFolder(
    filename: string,
    folderId: string,
  ): { path: number[]; folder: GroupLayerEntry } | null {
    const file = fileByName(filename)
    if (!file) return null
    const path = pathOf(file.page.layers, folderId)
    if (path === null) return null
    const folder = dissolveGroupAt(file.page.layers, path)
    if (folder === null) return null
    markPageDirty(filename)
    return { path, folder }
  }

  function restoreFolder(filename: string, path: number[], folder: GroupLayerEntry) {
    const file = fileByName(filename)
    if (!file) return
    if (!restoreGroupAt(file.page.layers, path, folder)) return
    markPageDirty(filename)
  }

  function setReadingOrder(filename: string, order: string[]) {
    const file = fileByName(filename)
    if (!file) return
    file.page.readingOrder = order
    markPageDirty(filename)
  }

  /** On top of everything, which is where an object arriving on a page belongs. */
  function appendEntry(filename: string, entry: LayerEntry) {
    const file = fileByName(filename)
    if (!file) return
    file.page.layers.push(entry)
    markPageDirty(filename)
  }

  /** Which page an entry is on, since the selection reaches across all of them. */
  function pageOfEntry(id: string): string | null {
    for (const file of files.value) {
      if (findEntry(file.page.layers, id)) return file.filename
    }
    return null
  }

  /** Anything on any page of the chapter — the selection reaches across them. */
  function entryById(id: string): LayerEntry | undefined {
    for (const file of files.value) {
      const found = findEntry(file.page.layers, id)
      if (found) return found
    }
    return undefined
  }

  function removeEntry(id: string): RemovedEntry | null {
    for (const file of files.value) {
      const path = pathOf(file.page.layers, id)
      if (path === null) continue
      const entry = removeAtPath(file.page.layers, path)
      if (entry === null) return null
      const carried = new Set(textObjects([entry]).map((t) => t.id))
      const order: Array<{ id: string; index: number }> = []
      file.page.readingOrder.forEach((orderedId, index) => {
        if (carried.has(orderedId)) order.push({ id: orderedId, index })
      })
      file.page.readingOrder = file.page.readingOrder.filter((o) => !carried.has(o))
      markPageDirty(file.filename)
      return { filename: file.filename, path, entry, order }
    }
    return null
  }

  /**
   * Undoes one removal. Reading-order places go back in ascending order, which
   * is what makes each recorded index still mean what it meant: the ones ahead
   * of it are already back in place by the time it lands.
   */
  function restoreEntry(removed: RemovedEntry): void {
    const file = fileByName(removed.filename)
    if (!file) return
    if (!insertAtPath(file.page.layers, removed.path, removed.entry)) {
      file.page.layers.push(removed.entry)
    }
    for (const { id, index } of removed.order) {
      file.page.readingOrder.splice(Math.min(index, file.page.readingOrder.length), 0, id)
    }
    markPageDirty(removed.filename)
  }

  function moveLayer(filename: string, fromPath: number[], target: DropTarget): boolean {
    const file = fileByName(filename)
    if (!file) return false
    if (!moveEntry(file.page.layers, fromPath, target)) return false
    markPageDirty(filename)
    return true
  }

  /**
   * Undoes a restack by putting an entry back at the path it left, which the
   * drop rules cannot express: their indices are read before the entry comes
   * out, and running them backwards lands one place off.
   */
  function restoreLayerAt(filename: string, layerId: string, path: number[]) {
    const file = fileByName(filename)
    if (!file) return
    const current = pathOf(file.page.layers, layerId)
    if (current === null) return
    const entry = removeAtPath(file.page.layers, current)
    if (entry === null) return
    insertAtPath(file.page.layers, path, entry)
    markPageDirty(filename)
  }

  function moveLabel(filename: string, labelId: string, x: number, y: number) {
    const label = labelById(filename, labelId)
    if (!label) return
    label.x = x
    label.y = y
    markPageDirty(filename)
  }

  function rotateLabel(filename: string, labelId: string, rotation: number) {
    const label = labelById(filename, labelId)
    if (!label) return
    label.rotation = rotation
    markPageDirty(filename)
  }

  function updateLabelText(filename: string, labelId: string, text: string) {
    const label = labelById(filename, labelId)
    if (!label) return
    label.lines = linesOf(text)
    markPageDirty(filename)
  }

  function updateLabelGroupId(filename: string, labelId: string, groupId: string | null) {
    const label = labelById(filename, labelId)
    if (!label) return
    label.groupId = groupId
    markPageDirty(filename)
  }


  function updateLabelStyleOverride(
    filename: string,
    labelId: string,
    styleOverride: TextLayerEntry['styleOverride'],
  ) {
    const label = labelById(filename, labelId)
    if (!label) return
    if (styleOverride === undefined || Object.keys(styleOverride).length === 0)
      delete label.styleOverride
    else label.styleOverride = styleOverride
    markPageDirty(filename)
  }

  

  
  function addGroup(name: string): StyleGroup | null {
    const groups = projectMeta.value.groups
    if (groups.some((g) => g.name === name)) return null
    const group: StyleGroup = {
      id: generateGroupId(),
      name,
      color: defaultColorForGroupIndex(groups.length),
      style: { ...DEFAULT_TEXT_STYLE },
    }
    groups.push(group)
    markMetaDirty()
    return group
  }

  function renameGroup(index: number, name: string) {
    const groups = projectMeta.value.groups
    if (index < 0 || index >= groups.length) return
    groups[index].name = name
    markMetaDirty()
  }

  
  function updateGroupStyle(index: number, patch: Partial<TextStyle>) {
    const groups = projectMeta.value.groups
    if (index < 0 || index >= groups.length) return
    groups[index].style = { ...groups[index].style, ...patch }
    markMetaDirty()
  }

  
  function updateDefaultStyle(patch: Partial<TextStyle>) {
    projectMeta.value.defaultStyle = { ...projectMeta.value.defaultStyle, ...patch }
    markMetaDirty()
  }

  
  function removeLastGroup(): StyleGroup | null {
    const groups = projectMeta.value.groups
    if (groups.length === 0) return null
    const removed = groups.pop() ?? null
    markMetaDirty()
    return removed
  }

  
  function restoreLastGroup(group: StyleGroup): void {
    projectMeta.value.groups.push(group)
    markMetaDirty()
  }

  function updateComment(text: string) {
    if (projectMeta.value.comment === text) return
    projectMeta.value.comment = text
    markMetaDirty()
  }

  const exportProfiles = computed(() => projectMeta.value.exportProfiles)

  /**
   * Both writers refuse rather than repair: a profile that would deliver into
   * a folder another one already owns has to be changed by whoever asked for
   * it, since silently nudging it would put the files somewhere they did not
   * choose.
   */
  function addExportProfile(profile: ExportProfile): void {
    const next = [...projectMeta.value.exportProfiles, profile]
    assertDistinctFolders(next)
    projectMeta.value.exportProfiles = next
    markMetaDirty()
  }

  function updateExportProfile(index: number, profile: ExportProfile): void {
    const profiles = projectMeta.value.exportProfiles
    if (index < 0 || index >= profiles.length) return
    const next = profiles.map((p, i) => (i === index ? profile : p))
    assertDistinctFolders(next)
    projectMeta.value.exportProfiles = next
    markMetaDirty()
  }

  function removeExportProfile(index: number): void {
    const profiles = projectMeta.value.exportProfiles
    if (index < 0 || index >= profiles.length) return
    projectMeta.value.exportProfiles = profiles.filter((_, i) => i !== index)
    markMetaDirty()
  }

  return {
    exportProfiles,
    addExportProfile,
    updateExportProfile,
    removeExportProfile,
    
    rootPath,
    projectMeta,
    files,
    dirtyFilenames,
    
    folderPath,
    header,
    dirty,
    isOpen,
    metaDirty,
    rawsDir,
    shashokuDir,
    layersDirOf,
    
    fileByName,
    labelsOf,
    labelById,
    reset,
    createNewProject,
    openExisting,
    openByPath,
    previewRescanImport,
    commitRescanImport,
    flush: autosave.flush,
    addLabel,
    deleteLabel,
    moveLabel,
    rotateLabel,
    updateLabelText,
    updateLabelGroupId,
    updateLabelStyleOverride,
    setLayerVisible,
    setLayerLocked,
    placeLayer,
    renameLayer,
    setLayerOpacity,
    setLayerBlendMode,
    entryById,
    pageOfEntry,
    setReadingOrder,
    appendEntry,
    removeEntry,
    restoreEntry,
    moveLayer,
    restoreLayerAt,
    addLayer,
    dissolveFolder,
    restoreFolder,
    addGroup,
    renameGroup,
    updateGroupStyle,
    updateDefaultStyle,
    removeLastGroup,
    restoreLastGroup,
    updateComment,
    markMetaDirty,
  }
})
