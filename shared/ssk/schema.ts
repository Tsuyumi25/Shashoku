




import type {
  DocTemplateMode,
  SskExportConfig,
  OutputFormat,
  TextDirectionMode,
} from './types'

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


export class ExportConfigParseError extends Error {}

function fail(message: string): never {
  throw new ExportConfigParseError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
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


export function parseExportConfigStrict(v: unknown, groupNames: readonly string[]): SskExportConfig {
  const d = defaultExportConfig()
  if (v === undefined || v === null) return d
  if (!isRecord(v)) fail('exportConfig 必須是物件')

  const docTemplate =
    v.docTemplate === undefined
      ? d.docTemplate
      : oneOf(v.docTemplate, DOC_TEMPLATE_MODES, 'exportConfig.docTemplate')
  const docTemplateFilename = nullableString(v.docTemplateFilename, 'exportConfig.docTemplateFilename')
  if (docTemplateFilename !== null && /[\\/]/.test(docTemplateFilename))
    fail('exportConfig.docTemplateFilename 只能是檔名,不可含路徑(工程檔要可攜)')

  const outputFolderName = nullableString(v.outputFolderName, 'exportConfig.outputFolderName')
  if (outputFolderName !== null && /[\\/]/.test(outputFolderName))
    fail('exportConfig.outputFolderName 只能是資料夾名,不可含路徑(工程檔要可攜)')

  
  const fontSizePx =
    v.fontSizePx === undefined
      ? nullableFiniteNumber(v.fontSizePt, 'exportConfig.fontSizePt')
      : nullableFiniteNumber(v.fontSizePx, 'exportConfig.fontSizePx')

  const exportGroupsRaw = v.exportGroups
  let exportGroups: string[] | null = null
  if (exportGroupsRaw !== undefined && exportGroupsRaw !== null) {
    if (!Array.isArray(exportGroupsRaw)) fail('exportConfig.exportGroups 必須是分組名陣列或 null')
    exportGroups = exportGroupsRaw.map((g, i) => {
      if (typeof g !== 'string' || !groupNames.includes(g))
        fail(`exportConfig.exportGroups[${i}] 必須是 groups 內既有的分組名`)
      return g
    })
  }

  return {
    docTemplate,
    docTemplateFilename,
    outputFormat:
      v.outputFormat === undefined
        ? d.outputFormat
        : oneOf(v.outputFormat, OUTPUT_FORMATS, 'exportConfig.outputFormat'),
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
