import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { LabelItem, ProjectFile, ProjectHeader } from '@/types/project'
import type { SskExportConfig, SskProject } from '@shared/ssk/types'
import { SSK_VERSION } from '@shared/ssk/types'
import { DEFAULT_GROUPS, SSK_FILE_SUFFIX, MAX_GROUPS } from '@shared/ssk/constants'
import { defaultExportConfig, parseSskProject, serializeSskProject } from '@shared/ssk/schema'

function defaultHeader(): ProjectHeader {
  return {
    groups: [...DEFAULT_GROUPS],
    comment: '',
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// ── 內部模型 ⇄ 工程檔格式的邊界轉換 ──
// UI 的譯文是單一 string;檔案格式是行陣列(斷行語義顯式化)

function toSskProject(
  header: ProjectHeader,
  files: ProjectFile[],
  exportConfig: SskExportConfig,
): SskProject {
  return {
    version: SSK_VERSION,
    groups: [...header.groups],
    comment: header.comment,
    images: files.map((f) => ({
      filename: f.filename,
      labels: f.labels.map((l) => ({
        id: l.id,
        x: l.x,
        y: l.y,
        category: l.category,
        lines: l.text.split('\n'),
      })),
    })),
    exportConfig,
  }
}

function fromSskProject(p: SskProject): { header: ProjectHeader; files: ProjectFile[] } {
  return {
    header: { groups: p.groups, comment: p.comment },
    files: p.images.map((img) => ({
      filename: img.filename,
      labels: img.labels.map((l): LabelItem => ({
        id: l.id,
        x: l.x,
        y: l.y,
        category: l.category,
        text: l.lines.join('\n'),
      })),
    })),
  }
}

/** 新建工程的預設檔名:資料夾名.ssk.json,撞名則加 _2、_3⋯ */
export function nextProjectFilename(folderBasename: string, existing: string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()))
  let candidate = `${folderBasename}${SSK_FILE_SUFFIX}`
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    candidate = `${folderBasename}_${n}${SSK_FILE_SUFFIX}`
  }
  return candidate
}

/** 磁碟圖檔與工程檔記錄對帳:檔案有磁碟無 → missing;磁碟有檔案無 → 排序後附加 */
export function reconcile(parsedFiles: ProjectFile[], diskImages: string[]): ProjectFile[] {
  const diskSet = new Set(diskImages)
  const known = new Set(parsedFiles.map((f) => f.filename))

  const result = parsedFiles.map((f) => ({ ...f, missing: !diskSet.has(f.filename) }))
  const extra = diskImages
    .filter((name) => !known.has(name))
    .sort(collator.compare)
    .map((filename): ProjectFile => ({ filename, labels: [] }))

  return [...result, ...extra]
}

/** 專案資料的唯一事實來源:header、files、exportConfig、dirty 與開檔/存檔。undo 由 editorStore 包裝。 */
export const useProjectStore = defineStore('project', () => {
  const folderPath = ref<string | null>(null)
  const projectFilePath = ref<string | null>(null)
  const header = ref<ProjectHeader>(defaultHeader())
  const files = ref<ProjectFile[]>([])
  const exportConfig = ref<SskExportConfig>(defaultExportConfig())
  const dirty = ref(false)

  const isOpen = computed(() => folderPath.value !== null)

  function fileByName(filename: string): ProjectFile | undefined {
    return files.value.find((f) => f.filename === filename)
  }

  function serialize(): string {
    return serializeSskProject(toSskProject(header.value, files.value, exportConfig.value))
  }

  /**
   * File > New:選圖片資料夾 → 建新工程 → 以「資料夾名.ssk.json」直接存檔。
   * 回傳建立的工程檔名;取消回傳 null。
   */
  async function createNewProject(): Promise<string | null> {
    const folder = await window.api.openProjectFolder()
    if (folder === null) return null

    const [images, ssks] = await Promise.all([
      window.api.listImages(folder),
      window.api.listSskFiles(folder),
    ])

    folderPath.value = folder
    newProject(images)

    const folderBasename = folder.split(/[\\/]/).pop() || 'project'
    const filename = nextProjectFilename(
      folderBasename,
      ssks.map((f) => f.filename),
    )

    const path = `${folder}/${filename}`
    await window.api.writeSskFile(path, serialize())
    projectFilePath.value = path
    dirty.value = false
    return filename
  }

  /**
   * File > Open:選 .ssk.json 檔,其所在資料夾即圖片資料夾。
   * 取消回傳 null;解析失敗往上拋(由 UI 顯示錯誤)。
   */
  async function openExisting(): Promise<string | null> {
    const picked = await window.api.openSskFile()
    if (picked === null) return null

    const images = await window.api.listImages(picked.dir)
    await loadProjectFile(picked.path, images)
    folderPath.value = picked.dir
    return picked.filename
  }

  /**
   * 以既知路徑開啟工程檔(不經對話框):dev 自動開啟用,未來「最近專案」
   * 也走這裡。路徑格式不合法回 null;讀取/解析失敗往上拋。
   */
  async function openByPath(sskPath: string): Promise<string | null> {
    const m = sskPath.match(/^(.+)[\\/]([^\\/]+)$/)
    if (!m) return null
    const [, dir, filename] = m
    const images = await window.api.listImages(dir)
    await loadProjectFile(sskPath, images)
    folderPath.value = dir
    return filename
  }

  async function loadProjectFile(path: string, diskImages?: string[]) {
    const images =
      diskImages ?? (folderPath.value ? await window.api.listImages(folderPath.value) : [])
    const raw = await window.api.readSskFile(path)
    const parsed = parseSskProject(raw)
    const { header: parsedHeader, files: parsedFiles } = fromSskProject(parsed)

    header.value = parsedHeader
    exportConfig.value = parsed.exportConfig
    files.value = reconcile(parsedFiles, images)
    projectFilePath.value = path
    // 對帳若附加了工程檔沒有的新圖檔,記憶體狀態已與磁碟不同
    dirty.value = parsedFiles.length !== files.value.length
  }

  function newProject(diskImages: string[]) {
    header.value = defaultHeader()
    exportConfig.value = defaultExportConfig()
    files.value = diskImages.map((filename): ProjectFile => ({ filename, labels: [] }))
    projectFilePath.value = null
    dirty.value = true
  }

  // ── label CRUD(純資料操作;undo 命令由 editorStore 建構)──

  function addLabel(filename: string, label: LabelItem, index?: number) {
    const file = fileByName(filename)
    if (!file) return
    if (index === undefined) file.labels.push(label)
    else file.labels.splice(index, 0, label)
    dirty.value = true
  }

  function deleteLabel(filename: string, labelId: string): number {
    const file = fileByName(filename)
    if (!file) return -1
    const index = file.labels.findIndex((l) => l.id === labelId)
    if (index !== -1) {
      file.labels.splice(index, 1)
      dirty.value = true
    }
    return index
  }

  function moveLabel(filename: string, labelId: string, x: number, y: number) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.x = x
    label.y = y
    dirty.value = true
  }

  function updateLabelText(filename: string, labelId: string, text: string) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.text = text
    dirty.value = true
  }

  function updateLabelCategory(filename: string, labelId: string, category: number) {
    const label = fileByName(filename)?.labels.find((l) => l.id === labelId)
    if (!label) return
    label.category = category
    dirty.value = true
  }

  // ── group ──

  function addGroup(name: string): boolean {
    if (header.value.groups.length >= MAX_GROUPS) return false
    header.value.groups.push(name)
    dirty.value = true
    return true
  }

  function renameGroup(index: number, name: string) {
    if (index < 0 || index >= header.value.groups.length) return
    header.value.groups[index] = name
    dirty.value = true
  }

  // ── save ──

  async function save(): Promise<'saved' | 'canceled' | 'noop'> {
    if (!folderPath.value) return 'noop'
    const content = serialize()
    if (projectFilePath.value) {
      await window.api.writeSskFile(projectFilePath.value, content)
    } else {
      const folderBasename = folderPath.value.split(/[\\/]/).pop() || 'project'
      const saved = await window.api.saveSskAs(
        folderPath.value,
        `${folderBasename}${SSK_FILE_SUFFIX}`,
        content,
      )
      if (saved === null) return 'canceled'
      projectFilePath.value = saved
    }
    dirty.value = false
    return 'saved'
  }

  return {
    folderPath,
    projectFilePath,
    header,
    files,
    exportConfig,
    dirty,
    isOpen,
    fileByName,
    serialize,
    createNewProject,
    openExisting,
    openByPath,
    loadProjectFile,
    newProject,
    addLabel,
    deleteLabel,
    moveLabel,
    updateLabelText,
    updateLabelCategory,
    addGroup,
    renameGroup,
    save,
  }
})
