import type {
  GroupLayerEntry,
  LayerEntry,
  LayerEntryBase,
  ManifestJson,
  OcrBlockLabel,
  OcrBlockPersisted,
  OcrJson,
  RasterLayerEntry,
  TextLayerEntry,
} from './types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { parsePartialTextStyle, serializePartialTextStyle } from '../text-style/schema'


export const BLEND_MODE_ALLOWLIST = [
  PASS_THROUGH,
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

/** An id for something that lives inside a page — a layer entry of any kind. */
export function generateId(): string {
  const c = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  return `lbl-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`
}



/**
 * A folder blends by passing through, everything else blends normally. Both are
 * left out of the file when they hold, so the common page carries neither key.
 */
function defaultBlendMode(kind: string): string {
  return kind === 'group' ? PASS_THROUGH : 'normal'
}

function parseLayerBase(v: Record<string, unknown>, at: string, kind: string): LayerEntryBase {
  const { id, visible, locked, opacity, blendMode } = v
  if (typeof visible !== 'boolean') fail(`${at}.visible 必須是布林`)
  if (typeof locked !== 'boolean') fail(`${at}.locked 必須是布林`)

  let finalOpacity = 1
  if (opacity !== undefined) {
    if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
      fail(`${at}.opacity 必須是 [0,1] 的數字`)
    finalOpacity = opacity
  }

  let finalBlendMode = defaultBlendMode(kind)
  if (blendMode !== undefined) {
    if (
      typeof blendMode !== 'string' ||
      !(BLEND_MODE_ALLOWLIST as readonly string[]).includes(blendMode)
    )
      fail(`${at}.blendMode 必須是 ${BLEND_MODE_ALLOWLIST.join(' | ')} 之一`)
    // Pass-through says "I have no buffer of my own", which is only something a
    // container can say. On a leaf it would have no meaning to honour.
    if (blendMode === PASS_THROUGH && kind !== 'group')
      fail(`${at}.blendMode「${PASS_THROUGH}」只能用在資料夾上`)
    finalBlendMode = blendMode
  }

  const finalId = typeof id === 'string' && id.length > 0 ? id : generateId()
  return { id: finalId, visible, locked, opacity: finalOpacity, blendMode: finalBlendMode }
}

function parseName(v: Record<string, unknown>, at: string): string {
  if (typeof v.name !== 'string') fail(`${at}.name 必須是字串`)
  return v.name
}

function parseFrameEdge(v: unknown, at: string, nonNegative: boolean): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${at} 必須是整數(頁面像素)`)
  if (nonNegative && v < 0) fail(`${at} 不可為負`)
  return v
}

function parseRasterEntry(v: Record<string, unknown>, at: string): RasterLayerEntry {
  const base = parseLayerBase(v, at, 'raster')
  const name = parseName(v, at)
  const { file, alphaLocked } = v
  if (typeof file !== 'string' || file.length === 0) fail(`${at}.file 必須是非空字串`)
  if (/[\\/]/.test(file)) fail(`${at}.file 只能是檔名,不可含路徑(避免逃逸出 pages/<n>/layers/)`)
  if (typeof alphaLocked !== 'boolean') fail(`${at}.alphaLocked 必須是布林`)
  return {
    kind: 'raster',
    ...base,
    name,
    file,
    x: parseFrameEdge(v.x, `${at}.x`, false),
    y: parseFrameEdge(v.y, `${at}.y`, false),
    w: parseFrameEdge(v.w, `${at}.w`, true),
    h: parseFrameEdge(v.h, `${at}.h`, true),
    alphaLocked,
  }
}

function parseTextEntry(
  v: Record<string, unknown>,
  at: string,
  validGroupIds: readonly string[] | null,
): TextLayerEntry {
  const base = parseLayerBase(v, at, 'text')
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

  let rotation = 0
  if (v.rotation !== undefined) {
    if (typeof v.rotation !== 'number' || !Number.isFinite(v.rotation))
      fail(`${at}.rotation 必須是數字(弧度)`)
    rotation = v.rotation
  }

  const entry: TextLayerEntry = {
    kind: 'text',
    ...base,
    x,
    y,
    groupId: groupId as string | null,
    rotation,
    lines: parsedLines,
  }
  if (v.styleOverride !== undefined) {
    entry.styleOverride = parsePartialTextStyle(v.styleOverride, `${at}.styleOverride`, fail)
  }
  return entry
}

function parseGroupEntry(
  v: Record<string, unknown>,
  at: string,
  validGroupIds: readonly string[] | null,
): GroupLayerEntry {
  const base = parseLayerBase(v, at, 'group')
  const name = parseName(v, at)
  const { children } = v
  if (!Array.isArray(children)) fail(`${at}.children 必須是陣列`)
  const parsedChildren = children.map((c, i) =>
    parseLayerEntry(c, `${at}.children[${i}]`, validGroupIds),
  )
  return { kind: 'group', ...base, name, children: parsedChildren }
}

function parseLayerEntry(
  v: unknown,
  at: string,
  validGroupIds: readonly string[] | null,
): LayerEntry {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const kind = v.kind
  if (kind === 'raster') return parseRasterEntry(v, at)
  if (kind === 'text') return parseTextEntry(v, at, validGroupIds)
  if (kind === 'group') return parseGroupEntry(v, at, validGroupIds)
  fail(`${at}.kind 必須是 raster | text | group 之一(取得 ${JSON.stringify(kind)})`)
}


function collectRasterFiles(entries: readonly LayerEntry[], out: string[]): void {
  for (const e of entries) {
    if (e.kind === 'raster') out.push(e.file)
    else if (e.kind === 'group') collectRasterFiles(e.children, out)
  }
}

export function defaultManifest(): ManifestJson {
  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision: 0, readingOrder: [], layers: [] }
}

/**
 * Structure only. Whether `readingOrder` and the tree agree with each other is
 * the repair layer's question, not this one — a page whose order has drifted is
 * still readable, and refusing to open it would be the worse answer.
 */
export function parseManifest(
  raw: string,
  validGroupIds: readonly string[] | null = null,
): ManifestJson {
  const data = parseJson(raw, 'manifest.json')
  if (!isRecord(data)) fail('manifest.json 頂層必須是物件')

  if (data.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > MANIFEST_SCHEMA_VERSION)
      fail(`manifest.json 由較新版本建立(schemaVersion ${data.schemaVersion}),請更新軟體`)
    fail(`不支援的 manifest.json 版本:${JSON.stringify(data.schemaVersion)}`)
  }

  const revisionRaw = data.revision
  let revision = 0
  if (revisionRaw !== undefined) {
    if (typeof revisionRaw !== 'number' || !Number.isFinite(revisionRaw) || revisionRaw < 0 || !Number.isInteger(revisionRaw))
      fail('manifest.json.revision 必須是 ≥ 0 的整數')
    revision = revisionRaw
  }

  const readingOrderRaw = data.readingOrder
  if (!Array.isArray(readingOrderRaw)) fail('manifest.json.readingOrder 必須是陣列')
  const readingOrder = readingOrderRaw.map((id, i) => {
    if (typeof id !== 'string' || id.length === 0)
      fail(`manifest.json.readingOrder[${i}] 必須是非空字串`)
    return id
  })

  const layersRaw = data.layers
  if (!Array.isArray(layersRaw)) fail('manifest.json.layers 必須是陣列')
  const layers = layersRaw.map((l, i) => parseLayerEntry(l, `layers[${i}]`, validGroupIds))

  const files: string[] = []
  collectRasterFiles(layers, files)
  if (new Set(files).size !== files.length) fail('manifest.json.layers[].file 不可重複')

  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision, readingOrder, layers }
}

function serializeLayerEntry(l: LayerEntry): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: l.kind,
    id: l.id,
    visible: l.visible,
    locked: l.locked,
  }
  if (l.opacity !== 1) base.opacity = l.opacity
  if (l.blendMode !== defaultBlendMode(l.kind)) base.blendMode = l.blendMode
  if (l.kind === 'raster') {
    return {
      ...base,
      name: l.name,
      file: l.file,
      x: l.x,
      y: l.y,
      w: l.w,
      h: l.h,
      alphaLocked: l.alphaLocked,
    }
  }
  if (l.kind === 'group') {
    return { ...base, name: l.name, children: l.children.map(serializeLayerEntry) }
  }
  const out: Record<string, unknown> = {
    ...base,
    x: l.x,
    y: l.y,
    groupId: l.groupId,
    lines: l.lines,
  }
  if (l.rotation) out.rotation = l.rotation
  if (l.styleOverride !== undefined && Object.keys(l.styleOverride).length > 0)
    out.styleOverride = serializePartialTextStyle(l.styleOverride)
  return out
}

/** The drawn part of a page, on its own — what a thumbnail's identity is made of. */
export function serializeLayers(layers: readonly LayerEntry[]): string {
  return JSON.stringify(layers.map(serializeLayerEntry))
}

export function serializeManifest(m: ManifestJson): string {
  const out = {
    schemaVersion: m.schemaVersion,
    revision: m.revision,
    readingOrder: m.readingOrder,
    layers: m.layers.map(serializeLayerEntry),
  }
  return `${JSON.stringify(out, null, 2)}\n`
}



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
