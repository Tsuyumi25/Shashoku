// shashoku/project.json 的解析/序列化/驗證。純函數,無 IO。
// 對比 shared/page/schema.ts:此檔負責「全書 metadata」,那邊負責「per-page 資料」。
import type { Glossary, ProjectJson, StyleGroup } from './types'
import { PROJECT_SCHEMA_VERSION } from './types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { parseTextStyle, serializeTextStyle } from '../text-style/schema'
import { defaultExportConfig, parseExportConfigStrict } from '../ssk/schema'
import { CATEGORY_COLORS, DEFAULT_GROUPS, MAX_GROUPS, RESERVED_GROUP_NAMES } from '../ssk/constants'

export class ProjectParseError extends Error {}

function fail(message: string): never {
  throw new ProjectParseError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function generateId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `grp-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

function parseStyleGroup(v: unknown, i: number): StyleGroup {
  const at = `groups[${i}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { id, name, color, style } = v
  if (typeof name !== 'string' || name.length === 0) fail(`${at}.name 必須是非空字串`)
  if (RESERVED_GROUP_NAMES.includes(name))
    fail(`${at}.name「${name}」是保留字(${RESERVED_GROUP_NAMES.join('、')}),請改名`)
  if (typeof color !== 'string' || color.length === 0) fail(`${at}.color 必須是非空字串`)
  const parsedStyle = parseTextStyle(style, `${at}.style`, fail)
  const finalId = typeof id === 'string' && id.length > 0 ? id : generateId()
  return { id: finalId, name, color, style: parsedStyle }
}

function parseGroups(v: unknown): StyleGroup[] {
  if (!Array.isArray(v) || v.length === 0) fail('groups 必須是至少一個 StyleGroup 的陣列')
  if (v.length > MAX_GROUPS) fail(`分組數量上限為 ${MAX_GROUPS},檔案內有 ${v.length} 個`)
  const groups = v.map((g, i) => parseStyleGroup(g, i))
  const names = groups.map((g) => g.name)
  if (new Set(names).size !== names.length) fail('分組 name 不可重複')
  const ids = groups.map((g) => g.id)
  if (new Set(ids).size !== ids.length) fail('分組 id 不可重複')
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

/** 依 index 從 CATEGORY_COLORS 循環取色,超過 length 回到 0 */
export function defaultColorForGroupIndex(i: number): string {
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length]
}

export function defaultProjectJson(): ProjectJson {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    groups: DEFAULT_GROUPS.map((name, i) => ({
      id: generateId(),
      name,
      color: defaultColorForGroupIndex(i),
      style: { ...DEFAULT_TEXT_STYLE },
    })),
    defaultStyle: { ...DEFAULT_TEXT_STYLE },
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
    fail(
      `不支援的 project.json 版本:${JSON.stringify(data.schemaVersion)}(v2 以下的舊格式需以新版重建專案)`,
    )
  }

  const groups = parseGroups(data.groups)
  const defaultStyle = parseTextStyle(data.defaultStyle, 'defaultStyle', fail)
  const comment = data.comment === undefined ? '' : data.comment
  if (typeof comment !== 'string') fail('comment 必須是字串')

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    groups,
    defaultStyle,
    comment,
    glossary: parseGlossary(data.glossary),
    exportConfig: parseExportConfigStrict(data.exportConfig, groups.map((g) => g.name)),
  }
}

/** 固定 key 順序,縮排 2、結尾換行,git diff 友善 */
export function serializeProjectJson(project: ProjectJson): string {
  const out: Record<string, unknown> = {
    schemaVersion: project.schemaVersion,
    groups: project.groups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      style: serializeTextStyle(g.style),
    })),
    defaultStyle: serializeTextStyle(project.defaultStyle),
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
