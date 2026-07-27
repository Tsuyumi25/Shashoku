import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LabelItem, ProjectFile, ProjectHeader } from '@/types/project'
import type { ProjectJson, StyleGroup } from '@shared/project/types'
import {
  defaultColorForGroupIndex,
  defaultProjectJson,
  parseProjectJson,
  serializeProjectJson,
} from '@shared/project/schema'
import { TRANSLATION_SCHEMA_VERSION } from '@shared/page/types'
import { parseTranslation, serializeTranslation } from '@shared/page/schema'
import { previewImport, type ImportDiff } from '@shared/project/import'
import { parentFolder } from '@shared/project/library'
import { assertDistinctFolders } from '@shared/export/profile'
import type { ExportProfile } from '@shared/export/types'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { DIR_LAYERS, DIR_RAWS, SHASHOKU_DIR } from '@shared/ssk/constants'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'
import { createAutosave } from '@/lib/autosave'

function generateGroupId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `grp-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}


function toLines(text: string): string[] {
  return text.split('\n')
}
function fromLines(lines: string[]): string {
  return lines.join('\n')
}


export function serializeTranslationForFile(file: ProjectFile): string {
  return serializeTranslation({
    schemaVersion: TRANSLATION_SCHEMA_VERSION,
    labels: file.labels.map((l) => {
      const entry: import('@shared/ssk/types').SskLabel = {
        id: l.id,
        x: l.x,
        y: l.y,
        groupId: l.groupId,
        lines: toLines(l.text),
      }
      if (l.rotation) entry.rotation = l.rotation
      if (l.styleOverride !== undefined) entry.styleOverride = l.styleOverride
      return entry
    }),
  })
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
  
  function layersDirOf(pageDir: string): string {
    return joinPath(pageDir, DIR_LAYERS)
  }

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
    const loaded: ProjectFile[] = []
    for (const p of pages) {
      if (p.badge === 'raw-missing') {
        
      }
      let labels: LabelItem[] = []
      try {
        const raw = await window.api.readPage(p.pageDir)
        const t = parseTranslation(raw.translationRaw, meta.groups.map((g) => g.id))
        labels = t.labels.map((l) => ({
          id: l.id,
          x: l.x,
          y: l.y,
          groupId: l.groupId,
          rotation: l.rotation ?? 0,
          text: fromLines(l.lines),
          styleOverride: l.styleOverride,
        }))
      } catch {
        
      }
      loaded.push({ filename: p.filename, pageDir: p.pageDir, labels, badge: p.badge })
    }
    rootPath.value = newRootPath
    projectMeta.value = meta
    files.value = loaded
    metaDirty.value = false
    dirtyFilenames.value = []
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
          translationRaw: serializeTranslationForFile(file),
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



  function addLabel(filename: string, label: LabelItem, index?: number) {
    const file = fileByName(filename)
    if (!file) return
    if (index === undefined) file.labels.push(label)
    else file.labels.splice(index, 0, label)
    markPageDirty(filename)
  }

  function deleteLabel(filename: string, labelId: string): number {
    const file = fileByName(filename)
    if (!file) return -1
    const index = file.labels.findIndex((l) => l.id === labelId)
    if (index !== -1) {
      file.labels.splice(index, 1)
      markPageDirty(filename)
    }
    return index
  }

  function moveLabel(filename: string, labelId: string, x: number, y: number) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.x = x
    label.y = y
    markPageDirty(filename)
  }

  function rotateLabel(filename: string, labelId: string, rotation: number) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.rotation = rotation
    markPageDirty(filename)
  }

  function updateLabelText(filename: string, labelId: string, text: string) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.text = text
    markPageDirty(filename)
  }

  function updateLabelGroupId(filename: string, labelId: string, groupId: string | null) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.groupId = groupId
    markPageDirty(filename)
  }

  
  function updateLabelStyleOverride(
    filename: string,
    labelId: string,
    styleOverride: LabelItem['styleOverride'],
  ) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
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
