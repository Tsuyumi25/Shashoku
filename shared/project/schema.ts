// shashoku/project.json 的解析/序列化/驗證。純函數,無 IO。
// 對比 shared/ssk/schema.ts 的 parseSskProject:此檔負責「全書 metadata」,
// 那邊(未來拆分後)負責「per-page 資料」。
import type { Glossary, ProjectJson } from './types'
import { PROJECT_SCHEMA_VERSION } from './types'
import { defaultExportConfig, parseExportConfigStrict } from '../ssk/schema'
import { MAX_GROUPS, RESERVED_GROUP_NAMES } from '../ssk/constants'

export class ProjectParseError extends Error {}

function fail(message: string): never {
  throw new ProjectParseError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseGroups(v: unknown): string[] {
  if (!Array.isArray(v) || v.length === 0) fail('groups 必須是至少一個分組名的陣列')
  if (v.length > MAX_GROUPS) fail(`分組數量上限為 ${MAX_GROUPS},檔案內有 ${v.length} 個`)
  const groups = v.map((g, i) => {
    if (typeof g !== 'string' || g.length === 0) fail(`groups[${i}] 必須是非空字串`)
    if (RESERVED_GROUP_NAMES.includes(g))
      fail(`分組名「${g}」是保留字(${RESERVED_GROUP_NAMES.join('、')}),請改名`)
    return g
  })
  if (new Set(groups).size !== groups.length) fail('分組名不可重複')
  return groups
}

function parseGlossary(v: unknown): Glossary | undefined {
  if (v === undefined) return undefined
  if (!isRecord(v)) fail('glossary 必須是物件(key = 原文, value = 譯文)')
  const out: Glossary = {}
  for (const [key, value] of Object.entries(v)) {
    if (typeof value !== 'string') fail(`glossary["${key}"] 必須是字串`)
    out[key] = value
  }
  return out
}

export function defaultProjectJson(): ProjectJson {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    groups: ['框内', '框外'],
    comment: '',
    exportConfig: defaultExportConfig(),
  }
}

export function parseProjectJson(raw: string): ProjectJson {
  // Windows 編輯器常存出 UTF-8 BOM,JSON.parse 會炸——先剝掉
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    fail(`不是合法的 JSON:${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isRecord(data)) fail('project.json 頂層必須是物件')

  if (data.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > PROJECT_SCHEMA_VERSION)
      fail(`project.json 由較新版本建立(schemaVersion ${data.schemaVersion}),請更新軟體`)
    fail(`不支援的 project.json 版本:${JSON.stringify(data.schemaVersion)}`)
  }

  const groups = parseGroups(data.groups)
  const comment = data.comment === undefined ? '' : data.comment
  if (typeof comment !== 'string') fail('comment 必須是字串')

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    groups,
    comment,
    glossary: parseGlossary(data.glossary),
    exportConfig: parseExportConfigStrict(data.exportConfig, groups),
  }
}

/** 固定 key 順序,縮排 2、結尾換行,git diff 友善 */
export function serializeProjectJson(project: ProjectJson): string {
  const out: Record<string, unknown> = {
    schemaVersion: project.schemaVersion,
    groups: project.groups,
    comment: project.comment,
  }
  if (project.glossary !== undefined) out.glossary = project.glossary
  out.exportConfig = {
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
  }
  return `${JSON.stringify(out, null, 2)}\n`
}
