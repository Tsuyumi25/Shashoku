// per-page JSON 的解析/序列化/驗證。純函數,無 IO。
// 三個獨立函式 parseManifest / parseTranslation / parseOcr,對應
// pages/<basename>/{manifest.json, translation.json, ocr.json}。
import type { SskLabel } from '../ssk/types'
import type {
  GroupLayerEntry,
  LayerEntry,
  ManifestJson,
  OcrBlockLabel,
  OcrBlockPersisted,
  OcrJson,
  RasterLayerEntry,
  TextLayerEntry,
  TranslationJson,
} from './types'
import {
  MANIFEST_SCHEMA_VERSION,
  OCR_SCHEMA_VERSION,
  TRANSLATION_SCHEMA_VERSION,
} from './types'
import { parsePartialTextStyle, serializePartialTextStyle } from '../text-style/schema'

// blend mode 白名單:與 src/engine/blend.ts 的 BLEND_MODES 保持同步(有 spec test 驗)
export const BLEND_MODE_ALLOWLIST = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const

const OCR_LABELS: OcrBlockLabel[] = ['bubble', 'text_bubble', 'text_free']

export class PageParseError extends Error {}

function fail(message: string): never {
  throw new PageParseError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
}

function parseJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(stripBom(raw))
  } catch (err) {
    fail(`${what} 不是合法的 JSON:${err instanceof Error ? err.message : String(err)}`)
  }
}

function generateId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `lbl-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}

// ── manifest.json ──

function parseLayerBase(v: Record<string, unknown>, at: string): {
  id: string
  name: string
  visible: boolean
  locked: boolean
} {
  const { id, name, visible, locked } = v
  if (typeof name !== 'string') fail(`${at}.name 必須是字串`)
  if (typeof visible !== 'boolean') fail(`${at}.visible 必須是布林`)
  if (typeof locked !== 'boolean') fail(`${at}.locked 必須是布林`)
  const finalId = typeof id === 'string' && id.length > 0 ? id : generateId()
  return { id: finalId, name, visible, locked }
}

function parseRasterEntry(v: Record<string, unknown>, at: string): RasterLayerEntry {
  const base = parseLayerBase(v, at)
  const { file, opacity, blendMode, alphaLocked } = v
  if (typeof file !== 'string' || file.length === 0) fail(`${at}.file 必須是非空字串`)
  if (/[\\/]/.test(file)) fail(`${at}.file 只能是檔名,不可含路徑(避免逃逸出 pages/<n>/layers/)`)
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    fail(`${at}.opacity 必須是 [0,1] 的數字`)
  if (typeof blendMode !== 'string' || !(BLEND_MODE_ALLOWLIST as readonly string[]).includes(blendMode))
    fail(`${at}.blendMode 必須是 ${BLEND_MODE_ALLOWLIST.join(' | ')} 之一`)
  if (typeof alphaLocked !== 'boolean') fail(`${at}.alphaLocked 必須是布林`)
  return { kind: 'raster', ...base, file, opacity, blendMode, alphaLocked }
}

function parseTextEntry(v: Record<string, unknown>, at: string): TextLayerEntry {
  const base = parseLayerBase(v, at)
  const { labelId } = v
  if (typeof labelId !== 'string' || labelId.length === 0) fail(`${at}.labelId 必須是非空字串`)
  return { kind: 'text', ...base, labelId }
}

function parseGroupEntry(v: Record<string, unknown>, at: string): GroupLayerEntry {
  const base = parseLayerBase(v, at)
  const { children, styleBinding } = v
  if (!Array.isArray(children)) fail(`${at}.children 必須是陣列`)
  const parsedChildren = children.map((c, i) => parseLayerEntry(c, `${at}.children[${i}]`))
  const out: GroupLayerEntry = { kind: 'group', ...base, children: parsedChildren }
  if (styleBinding !== undefined) {
    if (!isRecord(styleBinding)) fail(`${at}.styleBinding 必須是物件`)
    const { labelGroupId } = styleBinding
    if (typeof labelGroupId !== 'string' || labelGroupId.length === 0)
      fail(`${at}.styleBinding.labelGroupId 必須是非空字串`)
    out.styleBinding = { labelGroupId }
  }
  return out
}

function parseLayerEntry(v: unknown, at: string): LayerEntry {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const kind = v.kind
  if (kind === 'raster') return parseRasterEntry(v, at)
  if (kind === 'text') return parseTextEntry(v, at)
  if (kind === 'group') return parseGroupEntry(v, at)
  fail(`${at}.kind 必須是 raster | text | group 之一(取得 ${JSON.stringify(kind)})`)
}

/** 遞迴走 tree,收集所有 raster leaf 的檔名(用於重複檢查)。 */
function collectRasterFiles(entries: readonly LayerEntry[], out: string[]): void {
  for (const e of entries) {
    if (e.kind === 'raster') out.push(e.file)
    else if (e.kind === 'group') collectRasterFiles(e.children, out)
  }
}

export function defaultManifest(): ManifestJson {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, layers: [] }
}

export function parseManifest(raw: string): ManifestJson {
  const data = parseJson(raw, 'manifest.json')
  if (!isRecord(data)) fail('manifest.json 頂層必須是物件')

  if (data.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > MANIFEST_SCHEMA_VERSION)
      fail(`manifest.json 由較新版本建立(schemaVersion ${data.schemaVersion}),請更新軟體`)
    // v1 entries 都是 raster 且欄位對齊 v2 RasterLayerEntry,只差一個 kind;
    // silent upgrade,下次 autosave 會寫回 v2。原本計畫 POC 硬斷但實務上
    // dev 期既有專案要保命,加這層 tolerance 比逼手動重建現實。
    if (data.schemaVersion !== 1)
      fail(`不支援的 manifest.json 版本:${JSON.stringify(data.schemaVersion)}`)
  }

  // revision:非負整數,缺失視為 0(下次 autosave 會遞增)
  const revisionRaw = data.revision
  let revision = 0
  if (revisionRaw !== undefined) {
    if (typeof revisionRaw !== 'number' || !Number.isFinite(revisionRaw) || revisionRaw < 0 || !Number.isInteger(revisionRaw))
      fail('manifest.json.revision 必須是 ≥ 0 的整數')
    revision = revisionRaw
  }

  const layersRaw = data.layers
  if (!Array.isArray(layersRaw)) fail('manifest.json.layers 必須是陣列')
  const layers = layersRaw.map((l, i) => {
    // v1→v2 upgrade:補 kind='raster' 給沒有 kind 欄位的舊 entry
    const patched =
      data.schemaVersion === 1 && isRecord(l) && l.kind === undefined
        ? { ...l, kind: 'raster' }
        : l
    return parseLayerEntry(patched, `layers[${i}]`)
  })

  const files: string[] = []
  collectRasterFiles(layers, files)
  if (new Set(files).size !== files.length) fail('manifest.json.layers[].file 不可重複')

  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision, layers }
}

function serializeLayerEntry(l: LayerEntry): Record<string, unknown> {
  const base = { kind: l.kind, id: l.id, name: l.name, visible: l.visible, locked: l.locked }
  if (l.kind === 'raster') {
    return {
      ...base,
      file: l.file,
      opacity: l.opacity,
      blendMode: l.blendMode,
      alphaLocked: l.alphaLocked,
    }
  }
  if (l.kind === 'text') return { ...base, labelId: l.labelId }
  // group
  const out: Record<string, unknown> = { ...base, children: l.children.map(serializeLayerEntry) }
  if (l.styleBinding !== undefined) out.styleBinding = { labelGroupId: l.styleBinding.labelGroupId }
  return out
}

export function serializeManifest(m: ManifestJson): string {
  const out = {
    schemaVersion: m.schemaVersion,
    revision: m.revision,
    layers: m.layers.map(serializeLayerEntry),
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

// ── translation.json ──

function parseLabelForTranslation(v: unknown, i: number, validGroupIds: readonly string[] | null): SskLabel {
  const at = `labels[${i}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { x, y, groupId, lines } = v
  if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${at}.x 必須是數字`)
  if (typeof y !== 'number' || !Number.isFinite(y)) fail(`${at}.y 必須是數字`)
  if (groupId !== null && typeof groupId !== 'string')
    fail(`${at}.groupId 必須是 string(對應 project.groups[].id)或 null`)
  if (validGroupIds !== null && typeof groupId === 'string' && !validGroupIds.includes(groupId))
    fail(`${at}.groupId「${groupId}」不在目前 project.groups 內`)
  if (!Array.isArray(lines)) fail(`${at}.lines 必須是字串陣列`)
  const parsedLines = lines.map((line, j) => {
    if (typeof line !== 'string') fail(`${at}.lines[${j}] 必須是字串`)
    if (/[\r\n]/.test(line)) fail(`${at}.lines[${j}] 不可內嵌換行——斷行請用陣列元素表達`)
    return line
  })
  const id = typeof v.id === 'string' && v.id.length > 0 ? v.id : generateId()
  const label: SskLabel = { id, x, y, groupId: groupId as string | null, lines: parsedLines }
  if (v.styleOverride !== undefined) {
    label.styleOverride = parsePartialTextStyle(v.styleOverride, `${at}.styleOverride`, fail)
  }
  // 舊 v2 檔案的 anchorLayerId 欄位(C2 前的過渡遺留):silently ignore,
  // 由 LetterMode 依 label 現況重建 text layer 樹位置。
  return label
}

export function defaultTranslation(): TranslationJson {
  return { schemaVersion: TRANSLATION_SCHEMA_VERSION, labels: [] }
}

/**
 * @param validGroupIds 若已知 project.json 的 groups id 集合,傳入用於嚴格 groupId 驗證;
 *                       null 代表尚未載入 project.json,先寬鬆通過(呼叫端負責之後對齊)
 */
export function parseTranslation(
  raw: string,
  validGroupIds: readonly string[] | null = null,
): TranslationJson {
  const data = parseJson(raw, 'translation.json')
  if (!isRecord(data)) fail('translation.json 頂層必須是物件')

  if (data.schemaVersion !== TRANSLATION_SCHEMA_VERSION) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > TRANSLATION_SCHEMA_VERSION)
      fail(`translation.json 由較新版本建立,請更新軟體`)
    fail(
      `不支援的 translation.json 版本:${JSON.stringify(data.schemaVersion)}(v2 以下的舊格式需以新版重建專案)`,
    )
  }

  const labelsRaw = data.labels
  if (!Array.isArray(labelsRaw)) fail('translation.json.labels 必須是陣列')
  const labels = labelsRaw.map((l, i) => parseLabelForTranslation(l, i, validGroupIds))
  return { schemaVersion: TRANSLATION_SCHEMA_VERSION, labels }
}

export function serializeTranslation(t: TranslationJson): string {
  const out = {
    schemaVersion: t.schemaVersion,
    labels: t.labels.map((l) => {
      const entry: Record<string, unknown> = {
        id: l.id,
        x: l.x,
        y: l.y,
        groupId: l.groupId,
        lines: l.lines,
      }
      if (l.styleOverride !== undefined && Object.keys(l.styleOverride).length > 0)
        entry.styleOverride = serializePartialTextStyle(l.styleOverride)
      return entry
    }),
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

// ── ocr.json (選用) ──

function parseOcrBlock(v: unknown, i: number): OcrBlockPersisted {
  const at = `blocks[${i}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { x, y, w, h, label, score, text } = v
  if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${at}.x 必須是數字`)
  if (typeof y !== 'number' || !Number.isFinite(y)) fail(`${at}.y 必須是數字`)
  if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) fail(`${at}.w 必須是 ≥ 0 的數字`)
  if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) fail(`${at}.h 必須是 ≥ 0 的數字`)
  if (typeof label !== 'string' || !OCR_LABELS.includes(label as OcrBlockLabel))
    fail(`${at}.label 必須是 ${OCR_LABELS.join(' | ')} 之一`)
  if (typeof score !== 'number' || !Number.isFinite(score)) fail(`${at}.score 必須是數字`)
  const parsed: OcrBlockPersisted = { x, y, w, h, label: label as OcrBlockLabel, score }
  if (text !== undefined) {
    if (typeof text !== 'string') fail(`${at}.text 必須是字串`)
    parsed.text = text
  }
  return parsed
}

export function defaultOcr(width: number, height: number): OcrJson {
  return { schemaVersion: OCR_SCHEMA_VERSION, width, height, blocks: [] }
}

export function parseOcr(raw: string): OcrJson {
  const data = parseJson(raw, 'ocr.json')
  if (!isRecord(data)) fail('ocr.json 頂層必須是物件')

  if (data.schemaVersion !== OCR_SCHEMA_VERSION) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > OCR_SCHEMA_VERSION)
      fail(`ocr.json 由較新版本建立,請更新軟體`)
    fail(`不支援的 ocr.json 版本:${JSON.stringify(data.schemaVersion)}`)
  }

  const { width, height, blocks } = data
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)
    fail('ocr.json.width 必須是正數')
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0)
    fail('ocr.json.height 必須是正數')
  if (!Array.isArray(blocks)) fail('ocr.json.blocks 必須是陣列')

  return {
    schemaVersion: OCR_SCHEMA_VERSION,
    width,
    height,
    blocks: blocks.map((b, i) => parseOcrBlock(b, i)),
  }
}

export function serializeOcr(o: OcrJson): string {
  return `${JSON.stringify(
    {
      schemaVersion: o.schemaVersion,
      width: o.width,
      height: o.height,
      blocks: o.blocks,
    },
    null,
    2,
  )}\n`
}
