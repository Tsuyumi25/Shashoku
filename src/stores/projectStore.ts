import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LabelItem, ProjectFile, ProjectHeader } from '@/types/project'
import type { SskExportConfig } from '@shared/ssk/types'
import type { ProjectJson } from '@shared/project/types'
import { defaultProjectJson, parseProjectJson, serializeProjectJson } from '@shared/project/schema'
import { parseTranslation, serializeTranslation } from '@shared/page/schema'
import { previewImport, type ImportDiff } from '@shared/project/import'
import { DIR_LAYERS, DIR_RAWS, MAX_GROUPS, SHASHOKU_DIR } from '@shared/ssk/constants'

// 內部 model:UI 用單一 text string(換行原生),序列化邊界才轉 lines[]
function toLines(text: string): string[] {
  return text.split('\n')
}
function fromLines(lines: string[]): string {
  return lines.join('\n')
}

/** 把一個 ProjectFile 序列化成該頁 translation.json 內容(module level,test 可 import) */
export function serializeTranslationForFile(file: ProjectFile): string {
  return serializeTranslation({
    schemaVersion: 1,
    labels: file.labels.map((l) => {
      const entry: import('@shared/ssk/types').SskLabel = {
        id: l.id,
        x: l.x,
        y: l.y,
        category: l.category,
        lines: toLines(l.text),
      }
      if (l.anchorLayerId !== undefined) entry.anchorLayerId = l.anchorLayerId
      return entry
    }),
  })
}

/** rootPath + separator 拼接 shashoku/ 資料夾路徑;純字串,不觸碰 fs。 */
function shashokuDirOf(rootPath: string): string {
  return joinPath(rootPath, SHASHOKU_DIR)
}
function joinPath(...parts: string[]): string {
  // 前端用 forward slash;electron 端傳來的 pageDir 已是絕對路徑,不會經過這裡
  return parts.filter(Boolean).join('/')
}

/**
 * 專案資料的唯一事實來源。新架構:
 * - rootPath = 使用者選的原圖資料夾(其下有 shashoku/)
 * - projectMeta = shashoku/project.json 的解析結果
 * - files = 每頁一個條目(對應 pages/<stem>/ 資料夾)
 * - dirty 拆成 metaDirty + dirtyPages Set:save() 只寫變動的部分
 */
export const useProjectStore = defineStore('project', () => {
  const rootPath = ref<string | null>(null)
  const projectMeta = ref<ProjectJson>(defaultProjectJson())
  const files = ref<ProjectFile[]>([])
  const metaDirty = ref(false)
  // dirty 頁的 filename 集合;用 array + include 檢查(頁數不多,reactivity 直觀)
  const dirtyFilenames = ref<string[]>([])

  const isOpen = computed(() => rootPath.value !== null)
  const folderPath = computed(() => rootPath.value)
  const header = computed<ProjectHeader>(() => ({
    groups: projectMeta.value.groups,
    comment: projectMeta.value.comment,
  }))
  const exportConfig = computed<SskExportConfig>(() => projectMeta.value.exportConfig)
  const dirty = computed(() => metaDirty.value || dirtyFilenames.value.length > 0)
  /** shashoku/raws/ 的絕對路徑;LetterMode / autosave 讀底圖用 */
  const rawsDir = computed(() =>
    rootPath.value === null ? null : joinPath(rootPath.value, SHASHOKU_DIR, DIR_RAWS),
  )
  /** shashoku/ 的絕對路徑;寫 project.json 用 */
  const shashokuDir = computed(() =>
    rootPath.value === null ? null : joinPath(rootPath.value, SHASHOKU_DIR),
  )
  /** pages/<stem>/layers/ 的絕對路徑;每頁不同,取當前 file 用 file.pageDir 拼 */
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

  /** 把 IPC 回來的 OpenProjectResult 灌進 store(讀完每頁 translation.json)。 */
  async function ingestProject(newRootPath: string, projectMetaRaw: string, pages: Array<{
    filename: string
    pageDir: string
    badge: 'ok' | 'raw-missing' | 'page-missing'
  }>): Promise<void> {
    const meta = parseProjectJson(projectMetaRaw)
    const loaded: ProjectFile[] = []
    for (const p of pages) {
      if (p.badge === 'raw-missing') {
        // 孤兒 page 資料夾:仍讀 translation,讓使用者可查看/刪除
      }
      let labels: LabelItem[] = []
      try {
        const raw = await window.api.readPage(p.pageDir)
        const t = parseTranslation(raw.translationRaw, meta.groups.length)
        labels = t.labels.map((l) => ({
          id: l.id,
          x: l.x,
          y: l.y,
          category: l.category,
          text: fromLines(l.lines),
          anchorLayerId: l.anchorLayerId,
        }))
      } catch {
        // 損毀頁面:設空 labels,badge 已標示,不阻塞開檔
      }
      loaded.push({ filename: p.filename, pageDir: p.pageDir, labels, badge: p.badge })
    }
    rootPath.value = newRootPath
    projectMeta.value = meta
    files.value = loaded
    metaDirty.value = false
    dirtyFilenames.value = []
  }

  /** File > New:選 root → mkdir shashoku/ → 全複製原圖 → 灌 store。取消回傳 null。 */
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

  /** File > Open:選 root → 讀 shashoku/project.json + pages 對帳。取消回傳 null。 */
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

  /**
   * 建立純 in-memory 專案(不寫檔、不呼叫 IPC)。給測試 hydrate 用,
   * 也給未來「快速草稿模式」保留。rootPath 維持 null,save() 會走 noop。
   */
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

  /** 掃 root 跟目前 raws/ 對照,回傳 diff 給 UI 呈現。專案未開回 null。 */
  async function previewRescanImport(): Promise<ImportDiff | null> {
    if (rootPath.value === null) return null
    const scan = await window.api.scanRoot(rootPath.value)
    // raws/ 內的檔名 = files.value 已載入的 filename(with badge='ok' 或 'raw-missing');
    // 只認 badge !== 'raw-missing' 的(避免把「使用者已刪 root 但 raws 還有」的 orphan 又混進來)
    const rawImages = files.value
      .filter((f) => f.badge !== 'raw-missing')
      .map((f) => f.filename)
    return previewImport(scan.rootImages, rawImages)
  }

  /** 呼叫 IPC importPages 把選中的 root 圖匯入,並重載 store state。 */
  async function commitRescanImport(filenames: string[]): Promise<void> {
    if (rootPath.value === null) return
    const result = await window.api.importPages(rootPath.value, filenames)
    await ingestProject(rootPath.value, result.projectMetaRaw, result.pages)
  }

  /** dev 開機自動開啟用;傳入 rootPath 直接載入。失敗往上拋。 */
  async function openByPath(rootPathToOpen: string): Promise<string | null> {
    const scan = await window.api.scanRoot(rootPathToOpen)
    if (!scan.hasShashokuDir || !scan.hasSentinel) return null
    const result = await window.api.openProject(rootPathToOpen)
    await ingestProject(rootPathToOpen, result.projectMetaRaw, result.pages)
    return rootPathToOpen
  }

  /** 存所有 dirty 頁 + project.json(若 metaDirty)。無 open 專案回 'noop'。 */
  async function save(): Promise<'saved' | 'canceled' | 'noop'> {
    if (rootPath.value === null) return 'noop'
    if (!dirty.value) return 'saved'

    // 存 dirty 頁的 translation(只寫 translation.json;raster 由 autosave 獨立處理)
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

  // ── label CRUD(語意跟舊版一致;每動一次標該頁 dirty)──

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

  function updateLabelText(filename: string, labelId: string, text: string) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.text = text
    markPageDirty(filename)
  }

  function updateLabelCategory(filename: string, labelId: string, category: number) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.category = category
    markPageDirty(filename)
  }

  /** 設定 label 的 z-order 錨定:null = 清除(回到頂層 overlay);字串 = 錨到該 layer */
  function updateLabelAnchor(filename: string, labelId: string, layerId: string | null) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    if (layerId === null) delete label.anchorLayerId
    else label.anchorLayerId = layerId
    markPageDirty(filename)
  }

  // ── group(專案級 metadata,標 metaDirty)──

  function addGroup(name: string): boolean {
    if (projectMeta.value.groups.length >= MAX_GROUPS) return false
    projectMeta.value.groups.push(name)
    metaDirty.value = true
    return true
  }

  function renameGroup(index: number, name: string) {
    const groups = projectMeta.value.groups
    if (index < 0 || index >= groups.length) return
    groups[index] = name
    metaDirty.value = true
  }

  /** 移除尾部一組;供 cmdAddGroup 的 undo 呼叫,以確保 metaDirty 被標。 */
  function removeLastGroup(): void {
    if (projectMeta.value.groups.length === 0) return
    projectMeta.value.groups.pop()
    metaDirty.value = true
  }

  function updateComment(text: string) {
    if (projectMeta.value.comment === text) return
    projectMeta.value.comment = text
    metaDirty.value = true
  }

  /** 直接改 exportConfig 或 groups 後,UI 呼叫這個標髒(避免直接動 dirty computed) */
  function markMetaDirty() {
    metaDirty.value = true
  }

  return {
    // state (readonly-ish;某些欄位對外可寫是為了跟舊 test 保留相容)
    rootPath,
    projectMeta,
    files,
    dirtyFilenames,
    // computed
    folderPath,
    header,
    exportConfig,
    dirty,
    isOpen,
    metaDirty,
    rawsDir,
    shashokuDir,
    layersDirOf,
    // methods
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
    updateLabelText,
    updateLabelCategory,
    updateLabelAnchor,
    addGroup,
    renameGroup,
    removeLastGroup,
    updateComment,
    markMetaDirty,
  }
})
