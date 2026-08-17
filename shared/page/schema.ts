import type {
  GroupLayerEntry,
  LayerEntry,
  LayerEntryBase,
  ManifestJson,
  OcrCandidatePersisted,
  OcrJson,
  RasterLayerEntry,
  TextLayerEntry,
  TextSource,
  TranslationCandidate,
} from './types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { normalizeEdges, type ReadingEdge } from './readingGraph'
import { linesOf, textOf } from './text'
import { parseTextStyle, serializeTextStyle } from '../text-style/schema'
import { normalizeTagSet } from '../tags/set'
import { RESERVED_TAG_NAMES } from '../ssk/constants'


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

/**
 * Deliberately not checked against `project.tags`: the registry is advisory, so
 * a name it does not know is a tag the user typed and not a broken reference.
 */
function parseTags(v: unknown, at: string): string[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${at} 必須是字串陣列`)
  v.forEach((tag, i) => {
    if (typeof tag !== 'string' || tag.trim().length === 0)
      fail(`${at}[${i}] 必須是非空字串`)
    if (RESERVED_TAG_NAMES.includes(tag.trim()))
      fail(`${at}[${i}]「${tag}」是保留字(${RESERVED_TAG_NAMES.join('、')})`)
  })
  return normalizeTagSet(v as string[])
}

function parseTextEntry(v: Record<string, unknown>, at: string): TextLayerEntry {
  const base = parseLayerBase(v, at, 'text')
  const { x, y, lines } = v
  // Deliberately not integer-checked, unlike a raster layer's frame: what lands
  // on whole pixels is the rasterizer's output, not this.
  if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${at}.x 必須是數字(頁面像素)`)
  if (typeof y !== 'number' || !Number.isFinite(y)) fail(`${at}.y 必須是數字(頁面像素)`)
  const parsedLines = parseLines(lines, `${at}.lines`)

  let rotation = 0
  if (v.rotation !== undefined) {
    if (typeof v.rotation !== 'number' || !Number.isFinite(v.rotation))
      fail(`${at}.rotation 必須是數字(弧度)`)
    rotation = v.rotation
  }

  const translations = parseTranslations(v.translations, `${at}.translations`)

  return {
    kind: 'text',
    ...base,
    x,
    y,
    tags: parseTags(v.tags, `${at}.tags`),
    rotation,
    lines: parsedLines,
    source: parseTextSource(v.source, `${at}.source`),
    ownSource: parseOwnSource(v.ownSource, `${at}.ownSource`),
    translations,
    translation: parseTranslationSlot(v.translation, translations, `${at}.translation`),
    style: parseTextStyle(v.style, `${at}.style`, fail),
  }
}

function parseLines(v: unknown, at: string): string[] {
  if (!Array.isArray(v)) fail(`${at} 必須是字串陣列`)
  return v.map((line, j) => {
    if (typeof line !== 'string') fail(`${at}[${j}] 必須是字串`)
    if (/[\r\n]/.test(line)) fail(`${at}[${j}] 不可內嵌換行——斷行請用陣列元素表達`)
    return line
  })
}

function parseTranslations(v: unknown, at: string): TranslationCandidate[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${at} 必須是陣列`)
  const seen = new Set<string>()
  return v.map((entry, i) => {
    const where = `${at}[${i}]`
    if (!isRecord(entry)) fail(`${where} 必須是物件`)
    const { id, human, source } = entry
    if (typeof id !== 'string' || id.length === 0) fail(`${where}.id 必須是非空字串`)
    // The slot names one of these, so two of them answering to the same name
    // would make what the object reads as depend on which was searched first.
    if (seen.has(id)) fail(`${where}.id「${id}」重複`)
    seen.add(id)
    if (human !== undefined && typeof human !== 'boolean') fail(`${where}.human 必須是布林值`)
    if (source !== undefined && (typeof source !== 'string' || source.length === 0))
      fail(`${where}.source 必須是非空字串`)
    const candidate: TranslationCandidate = { id, lines: parseLines(entry.lines, `${where}.lines`) }
    if (human) candidate.human = true
    if (typeof source === 'string' && source.length > 0) candidate.source = source
    return candidate
  })
}

/**
 * A slot naming a candidate that is not there opens empty rather than
 * failing: `lines` still holds the person's own words, and refusing the page
 * over a dangling pointer would cost the translation to protect the choice.
 */
function parseTranslationSlot(
  v: unknown,
  pool: readonly TranslationCandidate[],
  at: string,
): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || v.length === 0) fail(`${at} 必須是非空字串或 null`)
  return pool.some((c) => c.id === v) ? v : null
}

/**
 * A page written before objects had a source opens with an empty slot held by
 * nobody — not `human`, or every object on it would start settled and out of
 * reach of the first run.
 */
function parseTextSource(v: unknown, at: string): TextSource {
  if (v === undefined) return { hash: null, by: 'auto' }
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { hash, by } = v
  if (hash !== null && hash !== 'own' && (typeof hash !== 'string' || hash.length === 0))
    fail(`${at}.hash 必須是非空字串、'own' 或 null`)
  if (by !== 'auto' && by !== 'human') fail(`${at}.by 必須是 auto 或 human`)
  return { hash: hash as string | 'own' | null, by }
}

function parseOwnSource(v: unknown, at: string): string {
  if (v === undefined) return ''
  if (typeof v !== 'string') fail(`${at} 必須是字串`)
  return v
}

function parseGroupEntry(v: Record<string, unknown>, at: string): GroupLayerEntry {
  const base = parseLayerBase(v, at, 'group')
  const name = parseName(v, at)
  const { children } = v
  if (!Array.isArray(children)) fail(`${at}.children 必須是陣列`)
  const parsedChildren = children.map((c, i) => parseLayerEntry(c, `${at}.children[${i}]`))
  return { kind: 'group', ...base, name, children: parsedChildren }
}

function parseLayerEntry(v: unknown, at: string): LayerEntry {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const kind = v.kind
  if (kind === 'raster') return parseRasterEntry(v, at)
  if (kind === 'text') return parseTextEntry(v, at)
  if (kind === 'group') return parseGroupEntry(v, at)
  fail(`${at}.kind 必須是 raster | text | group 之一(取得 ${JSON.stringify(kind)})`)
}


function collectRasterFiles(entries: readonly LayerEntry[], out: string[]): void {
  for (const e of entries) {
    if (e.kind === 'raster') out.push(e.file)
    else if (e.kind === 'group') collectRasterFiles(e.children, out)
  }
}

/**
 * A page with a size and a name and nothing on it. Layers are added by whoever
 * creates the page — a base map for one made from a source image, none at all
 * for one made blank.
 */
export function defaultManifest(name: string, width: number, height: number): ManifestJson {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision: 0,
    name,
    width,
    height,
    readingOrder: [],
    readingEdges: [],
    layers: [],
  }
}

/**
 * Stands in for a page whose manifest could not be read, so everything holding
 * a page can hold one of these without asking first. Nothing draws it — the
 * entry's badge is what says why it is here.
 *
 * A pixel rather than nothing, because a page with no size is a file that will
 * not parse, and a placeholder must not be able to become one.
 */
export function unreadablePage(name: string): ManifestJson {
  return defaultManifest(name, 1, 1)
}

/**
 * The layer a page made from a source image starts with.
 *
 * A raster like any other, with no type of its own and therefore no rule that
 * applies only to it. It arrives locked because it is what everything else gets
 * drawn on top of, and `locked` is an ordinary property the user can turn off —
 * which is the whole saving over a background layer that every reader of the
 * tree would have to remember is different.
 */
export function baseMapLayer(file: string, width: number, height: number): RasterLayerEntry {
  return {
    kind: 'raster',
    id: generateId(),
    visible: true,
    locked: true,
    opacity: 1,
    blendMode: 'normal',
    name: '底圖',
    file,
    x: 0,
    y: 0,
    w: width,
    h: height,
    alphaLocked: false,
  }
}

/**
 * An object pointed at itself is refused here rather than left to repair,
 * unlike an end that names nothing: a self-reference cannot be a page whose
 * parts have drifted apart, only a file describing something that has no
 * meaning to have.
 */
function parseReadingEdges(v: unknown): ReadingEdge[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail('manifest.json.readingEdges 必須是陣列')
  return normalizeEdges(
    v.map((entry, i) => {
      const at = `manifest.json.readingEdges[${i}]`
      if (!isRecord(entry)) fail(`${at} 必須是物件`)
      const { from, to } = entry
      if (typeof from !== 'string' || from.length === 0) fail(`${at}.from 必須是非空字串`)
      if (typeof to !== 'string' || to.length === 0) fail(`${at}.to 必須是非空字串`)
      if (from === to) fail(`${at} 的兩端是同一個物件`)
      return { from, to }
    }),
  )
}

/**
 * Required, because nothing on the page means anything without it: every
 * position is in page pixels, and there is no image underneath to measure
 * instead now that the base map is an ordinary layer.
 */
function parsePageSize(data: Record<string, unknown>): { width: number; height: number } {
  const { width, height } = data
  for (const [name, v] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
      fail(`manifest.json.${name} 必須是正數(頁面像素)`)
  }
  return { width: width as number, height: height as number }
}

/**
 * Structure only. Whether `readingOrder` and the tree agree with each other is
 * the repair layer's question, not this one — a page whose order has drifted is
 * still readable, and refusing to open it would be the worse answer.
 */
export function parseManifest(raw: string): ManifestJson {
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

  if (typeof data.name !== 'string' || data.name.length === 0)
    fail('manifest.json.name 必須是非空字串')

  const size = parsePageSize(data)

  const readingOrderRaw = data.readingOrder
  if (!Array.isArray(readingOrderRaw)) fail('manifest.json.readingOrder 必須是陣列')
  const readingOrder = readingOrderRaw.map((id, i) => {
    if (typeof id !== 'string' || id.length === 0)
      fail(`manifest.json.readingOrder[${i}] 必須是非空字串`)
    return id
  })

  const layersRaw = data.layers
  if (!Array.isArray(layersRaw)) fail('manifest.json.layers 必須是陣列')
  const layers = layersRaw.map((l, i) => parseLayerEntry(l, `layers[${i}]`))

  const files: string[] = []
  collectRasterFiles(layers, files)
  if (new Set(files).size !== files.length) fail('manifest.json.layers[].file 不可重複')

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision,
    name: data.name,
    ...size,
    readingOrder,
    readingEdges: parseReadingEdges(data.readingEdges),
    layers,
  }
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
    lines: l.lines,
  }
  if (l.tags.length > 0) out.tags = normalizeTagSet(l.tags)
  if (l.rotation) out.rotation = l.rotation
  // An empty slot held by nobody is what a fresh object has, so leaving it out
  // keeps a page of untouched objects from carrying a line of nothing on each.
  if (l.source.hash !== null || l.source.by !== 'auto') out.source = l.source
  if (l.ownSource.length > 0) out.ownSource = l.ownSource
  if (l.translations.length > 0) out.translations = l.translations
  if (l.translation !== null) out.translation = l.translation
  out.style = serializeTextStyle(l.style)
  return out
}

/**
 * The drawn part of a page, on its own — what a thumbnail's identity is made
 * of.
 *
 * A text object's tags and everything about its source go: they move no pixel,
 * and keeping them would throw away every thumbnail in the chapter for a pass
 * that changed nothing anybody can see.
 *
 * Translations collapse to the resolved text: the one in the slot is on the
 * artwork, the rest are proposals nobody can see — two objects reading the
 * same way are the same picture.
 */
export function serializeLayers(layers: readonly LayerEntry[]): string {
  const drawn = (entry: LayerEntry): Record<string, unknown> => {
    const out = serializeLayerEntry(entry)
    if (entry.kind === 'text') {
      delete out.tags
      delete out.source
      delete out.ownSource
      delete out.translations
      delete out.translation
      out.lines = linesOf(textOf(entry))
    } else if (entry.kind === 'group') {
      out.children = entry.children.map(drawn)
    }
    return out
  }
  return JSON.stringify(layers.map(drawn))
}

export function serializeManifest(m: ManifestJson): string {
  const out: Record<string, unknown> = {
    schemaVersion: m.schemaVersion,
    revision: m.revision,
    name: m.name,
    width: m.width,
    height: m.height,
  }
  out.readingOrder = m.readingOrder
  if (m.readingEdges.length > 0) out.readingEdges = normalizeEdges(m.readingEdges)
  out.layers = m.layers.map(serializeLayerEntry)
  return `${JSON.stringify(out, null, 2)}\n`
}



function parseOcrCandidate(v: unknown, i: number): OcrCandidatePersisted {
  const at = `candidates[${i}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { hash, source, text, original, x, y, w, h, confidence, label } = v

  // Free-form on purpose — an unknown source is still a reading someone can
  // use — but never empty: no identity means unrecognizable on a rerun, and
  // no source means it cannot say where it came from.
  const named = (value: unknown, key: string): string => {
    if (typeof value !== 'string' || value.length === 0) fail(`${at}.${key} 必須是非空字串`)
    return value as string
  }
  const finite = (value: unknown, key: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${at}.${key} 必須是數字`)
    return value as number
  }

  if (typeof text !== 'string') fail(`${at}.text 必須是字串`)
  if (typeof original !== 'string') fail(`${at}.original 必須是字串`)
  const width = finite(w, 'w')
  const height = finite(h, 'h')
  if (width < 0 || height < 0) fail(`${at} 的 w 和 h 必須 ≥ 0`)

  return {
    hash: named(hash, 'hash'),
    source: named(source, 'source'),
    text,
    original,
    x: finite(x, 'x'),
    y: finite(y, 'y'),
    w: width,
    h: height,
    confidence: finite(confidence, 'confidence'),
    label: named(label, 'label'),
  }
}

export function defaultOcr(width: number, height: number): OcrJson {
  return { schemaVersion: OCR_SCHEMA_VERSION, width, height, candidates: [] }
}

export function parseOcr(raw: string): OcrJson {
  const data = parseJson(raw, 'ocr.json')
  if (!isRecord(data)) fail('ocr.json 頂層必須是物件')

  if (data.schemaVersion !== OCR_SCHEMA_VERSION) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > OCR_SCHEMA_VERSION)
      fail(`ocr.json 由較新版本建立,請更新軟體`)
    fail(`不支援的 ocr.json 版本:${JSON.stringify(data.schemaVersion)}`)
  }

  const { width, height, candidates } = data
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0)
    fail('ocr.json.width 必須是正數')
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0)
    fail('ocr.json.height 必須是正數')
  if (!Array.isArray(candidates)) fail('ocr.json.candidates 必須是陣列')

  return {
    schemaVersion: OCR_SCHEMA_VERSION,
    width,
    height,
    candidates: candidates.map((c, i) => parseOcrCandidate(c, i)),
  }
}

export function serializeOcr(o: OcrJson): string {
  return `${JSON.stringify(
    {
      schemaVersion: o.schemaVersion,
      width: o.width,
      height: o.height,
      candidates: o.candidates,
    },
    null,
    2,
  )}\n`
}
