import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LabelItem, ProjectFile, ProjectHeader } from '@/types/project'
import type { SskExportConfig } from '@shared/ssk/types'
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
import { DIR_LAYERS, DIR_RAWS, SHASHOKU_DIR } from '@shared/ssk/constants'
import { DEFAULT_TEXT_STYLE, type TextStyle } from '@shared/text-style/types'

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
  const exportConfig = computed<SskExportConfig>(() => projectMeta.value.exportConfig)
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

  function markPageDirty(filename: string) {
    if (!dirtyFilenames.value.includes(filename)) dirtyFilenames.value.push(filename)
  }

  function reset() {
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

  
  function newProject(diskImages: string[]): void {
    projectMeta.value = defaultProjectJson()
    files.value = diskImages.map((filename): ProjectFile => ({
      filename,
      pageDir: '',
      labels: [],
      badge: 'ok',
    }))
    rootPath.value = null
    metaDirty.value = true
    dirtyFilenames.value = []
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

  
  async function save(): Promise<'saved' | 'canceled' | 'noop'> {
    if (rootPath.value === null) return 'noop'
    if (!dirty.value) return 'saved'

    
    for (const filename of [...dirtyFilenames.value]) {
      const file = fileByName(filename)
      if (!file) continue
      await window.api.writePage(file.pageDir, {
        translationRaw: serializeTranslationForFile(file),
      })
    }
    dirtyFilenames.value = []

    if (metaDirty.value) {
      await window.api.writeProjectMeta(
        shashokuDirOf(rootPath.value),
        serializeProjectJson(projectMeta.value),
      )
      metaDirty.value = false
    }
    return 'saved'
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
    metaDirty.value = true
    return group
  }

  function renameGroup(index: number, name: string) {
    const groups = projectMeta.value.groups
    if (index < 0 || index >= groups.length) return
    groups[index].name = name
    metaDirty.value = true
  }

  
  function updateGroupStyle(index: number, patch: Partial<TextStyle>) {
    const groups = projectMeta.value.groups
    if (index < 0 || index >= groups.length) return
    groups[index].style = { ...groups[index].style, ...patch }
    metaDirty.value = true
  }

  
  function updateDefaultStyle(patch: Partial<TextStyle>) {
    projectMeta.value.defaultStyle = { ...projectMeta.value.defaultStyle, ...patch }
    metaDirty.value = true
  }

  
  function removeLastGroup(): StyleGroup | null {
    const groups = projectMeta.value.groups
    if (groups.length === 0) return null
    const removed = groups.pop() ?? null
    metaDirty.value = true
    return removed
  }

  
  function restoreLastGroup(group: StyleGroup): void {
    projectMeta.value.groups.push(group)
    metaDirty.value = true
  }

  function updateComment(text: string) {
    if (projectMeta.value.comment === text) return
    projectMeta.value.comment = text
    metaDirty.value = true
  }

  
  function markMetaDirty() {
    metaDirty.value = true
  }

  return {
    
    rootPath,
    projectMeta,
    files,
    dirtyFilenames,
    
    folderPath,
    header,
    exportConfig,
    dirty,
    isOpen,
    metaDirty,
    rawsDir,
    shashokuDir,
    layersDirOf,
    
    fileByName,
    reset,
    newProject,
    createNewProject,
    openExisting,
    openByPath,
    previewRescanImport,
    commitRescanImport,
    save,
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
