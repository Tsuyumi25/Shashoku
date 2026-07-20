// per-page JSON 的解析/序列化/驗證。純函數,無 IO。
// 三個獨立函式 parseManifest / parseTranslation / parseOcr,對應
// pages/<basename>/{manifest.json, translation.json, ocr.json}。
import type { SskLabel } from '../ssk/types'
import type {
  LayerEntry,
  ManifestJson,
  OcrBlockLabel,
  OcrBlockPersisted,
  OcrJson,
  TranslationJson,
} from './types'
import {
  MANIFEST_SCHEMA_VERSION,
  OCR_SCHEMA_VERSION,
  TRANSLATION_SCHEMA_VERSION,
} from './types'

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

function parseLayerEntry(v: unknown, index: number): LayerEntry {
  const at = `layers[${index}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const {
    id,
    file,
    name,
    visible,
    opacity,
    blendMode,
    locked,
    alphaLocked,
  } = v

  if (typeof file !== 'string' || file.length === 0) fail(`${at}.file 必須是非空字串`)
  if (/[\\/]/.test(file)) fail(`${at}.file 只能是檔名,不可含路徑(避免逃逸出 pages/<n>/layers/)`)
  if (typeof name !== 'string') fail(`${at}.name 必須是字串`)
  if (typeof visible !== 'boolean') fail(`${at}.visible 必須是布林`)
  if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    fail(`${at}.opacity 必須是 [0,1] 的數字`)
  if (typeof blendMode !== 'string' || !(BLEND_MODE_ALLOWLIST as readonly string[]).includes(blendMode))
    fail(`${at}.blendMode 必須是 ${BLEND_MODE_ALLOWLIST.join(' | ')} 之一`)
  if (typeof locked !== 'boolean') fail(`${at}.locked 必須是布林`)
  if (typeof alphaLocked !== 'boolean') fail(`${at}.alphaLocked 必須是布林`)

  const finalId = typeof id === 'string' && id.length > 0 ? id : generateId()
  return { id: finalId, file, name, visible, opacity, blendMode, locked, alphaLocked }
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
    fail(`不支援的 manifest.json 版本:${JSON.stringify(data.schemaVersion)}`)
  }

  // revision:向後相容 — 舊 manifest 沒這欄位視為 0(下次 autosave 會遞增)
  const revisionRaw = data.revision
  let revision = 0
  if (revisionRaw !== undefined) {
    if (typeof revisionRaw !== 'number' || !Number.isFinite(revisionRaw) || revisionRaw < 0 || !Number.isInteger(revisionRaw))
      fail('manifest.json.revision 必須是 ≥ 0 的整數')
    revision = revisionRaw
  }

  const layersRaw = data.layers
  if (!Array.isArray(layersRaw)) fail('manifest.json.layers 必須是陣列')
  const layers = layersRaw.map((l, i) => parseLayerEntry(l, i))

  const files = layers.map((l) => l.file)
  if (new Set(files).size !== files.length) fail('manifest.json.layers[].file 不可重複')

  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision, layers }
}

export function serializeManifest(m: ManifestJson): string {
  const out = {
    schemaVersion: m.schemaVersion,
    revision: m.revision,
    layers: m.layers.map((l) => ({
      id: l.id,
      file: l.file,
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      blendMode: l.blendMode,
      locked: l.locked,
      alphaLocked: l.alphaLocked,
    })),
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

// ── translation.json ──

function parseLabelForTranslation(v: unknown, i: number, groupCount: number | null): SskLabel {
  const at = `labels[${i}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { x, y, category, lines } = v
  if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${at}.x 必須是數字`)
  if (typeof y !== 'number' || !Number.isFinite(y)) fail(`${at}.y 必須是數字`)
  if (typeof category !== 'number' || !Number.isInteger(category) || category < 1)
    fail(`${at}.category 必須是 ≥ 1 的整數`)
  if (groupCount !== null && category > groupCount)
    fail(`${at}.category (${category}) 超出目前 groups 數量 (${groupCount})`)
  if (!Array.isArray(lines)) fail(`${at}.lines 必須是字串陣列`)
  const parsedLines = lines.map((line, j) => {
    if (typeof line !== 'string') fail(`${at}.lines[${j}] 必須是字串`)
    if (/[\r\n]/.test(line)) fail(`${at}.lines[${j}] 不可內嵌換行——斷行請用陣列元素表達`)
    return line
  })
  const id = typeof v.id === 'string' && v.id.length > 0 ? v.id : generateId()
  const label: SskLabel = { id, x, y, category, lines: parsedLines }
  // anchorLayerId 選用:字串則保留;未設或非字串則不帶(undefined)
  if (typeof v.anchorLayerId === 'string' && v.anchorLayerId.length > 0) {
    label.anchorLayerId = v.anchorLayerId
  }
  return label
}

export function defaultTranslation(): TranslationJson {
  return { schemaVersion: TRANSLATION_SCHEMA_VERSION, labels: [] }
}

/**
 * @param groupCount 若已知 project.json 的 groups 數量,傳入用於嚴格 category 驗證;
 *                   null 代表尚未載入 project.json,先寬鬆通過(呼叫端負責之後對齊)
 */
export function parseTranslation(raw: string, groupCount: number | null = null): TranslationJson {
  const data = parseJson(raw, 'translation.json')
  if (!isRecord(data)) fail('translation.json 頂層必須是物件')

  if (data.schemaVersion !== TRANSLATION_SCHEMA_VERSION) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > TRANSLATION_SCHEMA_VERSION)
      fail(`translation.json 由較新版本建立,請更新軟體`)
    fail(`不支援的 translation.json 版本:${JSON.stringify(data.schemaVersion)}`)
  }

  const labelsRaw = data.labels
  if (!Array.isArray(labelsRaw)) fail('translation.json.labels 必須是陣列')
  const labels = labelsRaw.map((l, i) => parseLabelForTranslation(l, i, groupCount))
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
        category: l.category,
        lines: l.lines,
      }
      if (l.anchorLayerId !== undefined) entry.anchorLayerId = l.anchorLayerId
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
