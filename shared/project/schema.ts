

import type { Glossary, ProjectJson } from './types'
import { PROJECT_SCHEMA_VERSION } from './types'
import type { TagDefinition } from '../tags/types'
import { DEFAULT_TEXT_STYLE } from '../text-style/types'
import { parseTextStyle, serializeTextStyle } from '../text-style/schema'
import { CATEGORY_COLORS, DEFAULT_TAGS, RESERVED_TAG_NAMES } from '../ssk/constants'
import { parseExportProfiles, serializeExportProfiles } from '../export/schema'

export class ProjectParseError extends Error {}

function fail(message: string): never {
  throw new ProjectParseError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * The name is the identity — there is no id to point at. A tag on an object is
 * the string itself, so a registry entry can go missing without anything on the
 * page becoming a dangling reference.
 */
function parseTagDefinition(v: unknown, i: number): TagDefinition {
  const at = `tags[${i}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { name, color } = v
  if (typeof name !== 'string' || name.length === 0) fail(`${at}.name 必須是非空字串`)
  if (name.trim() !== name) fail(`${at}.name 前後不可有空白`)
  if (RESERVED_TAG_NAMES.includes(name))
    fail(`${at}.name「${name}」是保留字(${RESERVED_TAG_NAMES.join('、')}),請改名`)
  if (typeof color !== 'string' || color.length === 0) fail(`${at}.color 必須是非空字串`)
  return { name, color }
}

/** Unlike the groups it replaces, an empty registry is a legal project. */
function parseTags(v: unknown): TagDefinition[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail('tags 必須是陣列')
  const tags = v.map((t, i) => parseTagDefinition(t, i))
  const names = tags.map((t) => t.name)
  if (new Set(names).size !== names.length) fail('標記 name 不可重複')
  return tags
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


export function defaultColorForTagIndex(i: number): string {
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length]
}

export function defaultProjectJson(): ProjectJson {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tags: DEFAULT_TAGS.map((name, i) => ({ name, color: defaultColorForTagIndex(i) })),
    seedStyle: { ...DEFAULT_TEXT_STYLE },
    comment: '',
    exportProfiles: [],
  }
}

export function parseProjectJson(raw: string): ProjectJson {
  
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
      `不支援的 project.json 版本:${JSON.stringify(data.schemaVersion)}(v3 以下的舊格式需以新版重建專案)`,
    )
  }

  const tags = parseTags(data.tags)
  const seedStyle = parseTextStyle(data.seedStyle, 'seedStyle', fail)
  const comment = data.comment === undefined ? '' : data.comment
  if (typeof comment !== 'string') fail('comment 必須是字串')

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    tags,
    seedStyle,
    comment,
    glossary: parseGlossary(data.glossary),
    exportProfiles: parseExportProfiles(data.exportProfiles),
  }
}


export function serializeProjectJson(project: ProjectJson): string {
  const out: Record<string, unknown> = {
    schemaVersion: project.schemaVersion,
    tags: project.tags.map((t) => ({ name: t.name, color: t.color })),
    seedStyle: serializeTextStyle(project.seedStyle),
    comment: project.comment,
  }
  if (project.glossary !== undefined) out.glossary = project.glossary
  out.exportProfiles = serializeExportProfiles(project.exportProfiles)
  return `${JSON.stringify(out, null, 2)}\n`
}
