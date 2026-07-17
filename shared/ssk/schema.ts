// .ssk.json 的解析/序列化/驗證。只在 YALP 端(node/瀏覽器)使用;
// jsx 端(ES3)有自己的最小解析器,兩端行為以本檔的 fixtures 對齊。
import type {
  DocTemplateMode,
  SskExportConfig,
  SskImage,
  SskLabel,
  SskProject,
  OutputFormat,
  TextDirectionMode,
} from './types'
import { SSK_VERSION } from './types'
import { MAX_GROUPS, RESERVED_GROUP_NAMES } from './constants'

const DOC_TEMPLATE_MODES: DocTemplateMode[] = ['auto', 'none', 'custom']
const TEXT_DIRECTION_MODES: TextDirectionMode[] = ['keep', 'horizontal', 'vertical']
const OUTPUT_FORMATS: OutputFormat[] = ['psd', 'tiff', 'png', 'jpg']

export function defaultExportConfig(): SskExportConfig {
  return {
    docTemplate: 'auto',
    docTemplateFilename: null,
    outputFormat: 'psd',
    ignoreNoLabelImages: true,
    createLayerGroups: true,
    font: null,
    fontSizePx: null,
    textColor: '#000000',
    textLeadingPercent: null,
    textDirection: 'keep',
    outputLabelIndex: false,
    actionSetName: null,
    outputFolderName: null,
    exportGroups: null,
  }
}

export function defaultSskProject(imageFilenames: string[]): SskProject {
  return {
    version: SSK_VERSION,
    groups: ['框内', '框外'],
    comment: '',
    images: imageFilenames.map((filename) => ({ filename, labels: [] })),
    exportConfig: defaultExportConfig(),
  }
}

/** 解析失敗時拋出,message 是給用戶看的人話 */
export class SskParseError extends Error {}

function fail(message: string): never {
  throw new SskParseError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function generateId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  // 測試/舊環境 fallback:碰撞機率對單一工程檔規模可忽略
  return `lbl-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

function parseGroups(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) fail('groups 必須是至少一個分組名的陣列')
  if (v.length > MAX_GROUPS) fail(`分組數量上限為 ${MAX_GROUPS},檔案內有 ${v.length} 個`)
  const groups = v.map((g, i) => {
    if (typeof g !== 'string' || g.length === 0) fail(`groups[${i}] 必須是非空字串`)
    if (RESERVED_GROUP_NAMES.includes(g)) fail(`分組名「${g}」是保留字(${RESERVED_GROUP_NAMES.join('、')}),請改名`)
    return g
  })
  if (new Set(groups).size !== groups.length) fail('分組名不可重複')
  return groups
}

function parseLabel(v: unknown, imageIndex: number, labelIndex: number, groupCount: number): SskLabel {
  const at = `images[${imageIndex}].labels[${labelIndex}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { x, y, category, lines } = v
  if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${at}.x 必須是數字`)
  if (typeof y !== 'number' || !Number.isFinite(y)) fail(`${at}.y 必須是數字`)
  if (typeof category !== 'number' || !Number.isInteger(category) || category < 1 || category > groupCount)
    fail(`${at}.category 必須是 1~${groupCount} 的整數(對應 groups)`)
  if (!Array.isArray(lines)) fail(`${at}.lines 必須是字串陣列`)
  const parsedLines = lines.map((line, i) => {
    if (typeof line !== 'string') fail(`${at}.lines[${i}] 必須是字串`)
    if (/[\r\n]/.test(line)) fail(`${at}.lines[${i}] 不可內嵌換行——斷行請用陣列元素表達`)
    return line
  })
  const id = typeof v.id === 'string' && v.id.length > 0 ? v.id : generateId()
  return { id, x, y, category, lines: parsedLines }
}

function parseImages(v: unknown, groupCount: number): SskImage[] {
  if (!Array.isArray(v)) fail('images 必須是陣列')
  const images = v.map((img, i) => {
    if (!isRecord(img)) fail(`images[${i}] 必須是物件`)
    if (typeof img.filename !== 'string' || img.filename.length === 0) fail(`images[${i}].filename 必須是非空字串`)
    const labels = Array.isArray(img.labels)
      ? img.labels.map((l, j) => parseLabel(l, i, j, groupCount))
      : fail(`images[${i}].labels 必須是陣列`)
    return { filename: img.filename, labels }
  })
  const names = images.map((img) => img.filename)
  if (new Set(names).size !== names.length) fail('images 內有重複的圖片檔名')
  return images
}

function oneOf<T extends string>(v: unknown, allowed: T[], at: string): T {
  if (typeof v !== 'string' || !(allowed as string[]).includes(v))
    fail(`${at} 必須是 ${allowed.join(' | ')} 之一`)
  return v as T
}

function nullableString(v: unknown, at: string): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') fail(`${at} 必須是字串或 null`)
  return v
}

function nullableFiniteNumber(v: unknown, at: string): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${at} 必須是數字或 null`)
  return v
}

function hexColor(v: unknown, at: string, fallback: string): string {
  if (v === undefined) return fallback
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v))
    fail(`${at} 必須是 #rrggbb 格式的顏色`)
  return v.toLowerCase()
}

function bool(v: unknown, at: string, fallback: boolean): boolean {
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') fail(`${at} 必須是布林值`)
  return v
}

/** 缺欄位補預設值(v2 升級路徑);存在但值非法則拋錯(手改檔案的錯字要大聲失敗) */
function parseExportConfig(v: unknown, groups: string[]): SskExportConfig {
  const d = defaultExportConfig()
  if (v === undefined || v === null) return d
  if (!isRecord(v)) fail('exportConfig 必須是物件')

  const docTemplate =
    v.docTemplate === undefined ? d.docTemplate : oneOf(v.docTemplate, DOC_TEMPLATE_MODES, 'exportConfig.docTemplate')
  const docTemplateFilename = nullableString(v.docTemplateFilename, 'exportConfig.docTemplateFilename')
  if (docTemplateFilename !== null && /[\\/]/.test(docTemplateFilename))
    fail('exportConfig.docTemplateFilename 只能是檔名,不可含路徑(工程檔要可攜)')

  const outputFolderName = nullableString(v.outputFolderName, 'exportConfig.outputFolderName')
  if (outputFolderName !== null && /[\\/]/.test(outputFolderName))
    fail('exportConfig.outputFolderName 只能是資料夾名,不可含路徑(工程檔要可攜)')

  // POC 舊檔的 fontSizePt 實際在 Electron 被當 px 使用；讀取時直接遷移成 px。
  const fontSizePx =
    v.fontSizePx === undefined
      ? nullableFiniteNumber(v.fontSizePt, 'exportConfig.fontSizePt')
      : nullableFiniteNumber(v.fontSizePx, 'exportConfig.fontSizePx')

  const exportGroupsRaw = v.exportGroups
  let exportGroups: string[] | null = null
  if (exportGroupsRaw !== undefined && exportGroupsRaw !== null) {
    if (!Array.isArray(exportGroupsRaw)) fail('exportConfig.exportGroups 必須是分組名陣列或 null')
    exportGroups = exportGroupsRaw.map((g, i) => {
      if (typeof g !== 'string' || !groups.includes(g))
        fail(`exportConfig.exportGroups[${i}] 必須是 groups 內既有的分組名`)
      return g
    })
  }

  return {
    docTemplate,
    docTemplateFilename,
    outputFormat:
      v.outputFormat === undefined ? d.outputFormat : oneOf(v.outputFormat, OUTPUT_FORMATS, 'exportConfig.outputFormat'),
    ignoreNoLabelImages: bool(v.ignoreNoLabelImages, 'exportConfig.ignoreNoLabelImages', d.ignoreNoLabelImages),
    createLayerGroups: bool(v.createLayerGroups, 'exportConfig.createLayerGroups', d.createLayerGroups),
    font: nullableString(v.font, 'exportConfig.font'),
    fontSizePx,
    textColor: hexColor(v.textColor, 'exportConfig.textColor', d.textColor),
    textLeadingPercent: nullableFiniteNumber(v.textLeadingPercent, 'exportConfig.textLeadingPercent'),
    textDirection:
      v.textDirection === undefined
        ? d.textDirection
        : oneOf(v.textDirection, TEXT_DIRECTION_MODES, 'exportConfig.textDirection'),
    outputLabelIndex: bool(v.outputLabelIndex, 'exportConfig.outputLabelIndex', d.outputLabelIndex),
    actionSetName: nullableString(v.actionSetName, 'exportConfig.actionSetName'),
    outputFolderName,
    exportGroups,
  }
}

export function parseSskProject(raw: string): SskProject {
  // Windows 編輯器常存出 UTF-8 BOM,JSON.parse 會炸——先剝掉
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    fail(`不是合法的 JSON:${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isRecord(data)) fail('工程檔頂層必須是物件')

  if (data.version !== SSK_VERSION) {
    if (typeof data.version === 'number' && data.version > SSK_VERSION)
      fail(`此工程檔由較新版本建立(version ${data.version}),請更新軟體`)
    fail(`不支援的工程檔版本:${JSON.stringify(data.version)}`)
  }

  const groups = parseGroups(data.groups)
  const comment = data.comment === undefined ? '' : data.comment
  if (typeof comment !== 'string') fail('comment 必須是字串')

  return {
    version: SSK_VERSION,
    groups,
    comment,
    images: parseImages(data.images, groups.length),
    exportConfig: parseExportConfig(data.exportConfig, groups),
  }
}

/** 固定 key 順序建構(不依賴輸入物件的插入順序),縮排 2、結尾換行,git diff 友善 */
export function serializeSskProject(project: SskProject): string {
  const out = {
    version: project.version,
    groups: project.groups,
    comment: project.comment,
    exportConfig: {
      docTemplate: project.exportConfig.docTemplate,
      docTemplateFilename: project.exportConfig.docTemplateFilename,
      outputFormat: project.exportConfig.outputFormat,
      ignoreNoLabelImages: project.exportConfig.ignoreNoLabelImages,
      createLayerGroups: project.exportConfig.createLayerGroups,
      font: project.exportConfig.font,
      fontSizePx: project.exportConfig.fontSizePx,
      textColor: project.exportConfig.textColor,
      textLeadingPercent: project.exportConfig.textLeadingPercent,
      textDirection: project.exportConfig.textDirection,
      outputLabelIndex: project.exportConfig.outputLabelIndex,
      actionSetName: project.exportConfig.actionSetName,
      outputFolderName: project.exportConfig.outputFolderName,
      exportGroups: project.exportConfig.exportGroups,
    },
    images: project.images.map((img) => ({
      filename: img.filename,
      labels: img.labels.map((l) => ({
        id: l.id,
        x: l.x,
        y: l.y,
        category: l.category,
        lines: l.lines,
      })),
    })),
  }
  return `${JSON.stringify(out, null, 2)}\n`
}
