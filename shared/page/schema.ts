import type {
  GroupLayerEntry,
  LayerEntry,
  LayerEntryBase,
  ManifestJson,
  OcrCandidatePersisted,
  OcrJson,
  RasterLayerEntry,
  SourceBody,
  SourceTextLayerEntry,
  TextBody,
  TextLayerEntry,
  TranslationCandidate,
  TranslationTextLayerEntry,
  TranslationUnit,
  TranslationUnitSide,
} from './types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { normalizeEdges, type ReadingEdge } from './readingGraph'
import type { TextSide } from './text'
import { linesAt, placeOfBlock } from './units'
import { escapeText } from './markup'
import { textObjects } from './tree'
import { parseEffects, serializeEffects } from '../effects/schema'
import { parseTextStyle, serializeTextStyle } from '../text-style/schema'
import type { TextStyle } from '../text-style/types'
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

/**
 * The last version whose bodies held plain text. Everything it stored is read
 * as the markup it would have been written as — escaping is the whole
 * migration, because a `<` the user typed back then meant a `<` and not a tag.
 */
const PLAIN_TEXT_VERSION = 13


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
  return {
    id: finalId,
    visible,
    locked,
    opacity: finalOpacity,
    blendMode: finalBlendMode,
    effects: parseEffects(v.effects, `${at}.effects`, fail),
  }
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
  const { side } = v
  if (side !== 'source' && side !== 'translation')
    fail(`${at}.side 必須是 source 或 translation(取得 ${JSON.stringify(side)})`)
  if (side === 'source')
    return { kind: 'text', ...base, side, body: parseSourceBody(v.body, `${at}.body`) }
  return { kind: 'text', ...base, side, body: parseTextBody(v.body, `${at}.body`).body }
}

function parseTextBody(v: unknown, at: string): { body: TextBody; raw: Record<string, unknown> } {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { x, y } = v
  // Deliberately not integer-checked, unlike a raster layer's frame: what lands
  // on whole pixels is the rasterizer's output, not this.
  if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${at}.x 必須是數字(頁面像素)`)
  if (typeof y !== 'number' || !Number.isFinite(y)) fail(`${at}.y 必須是數字(頁面像素)`)

  let rotation = 0
  if (v.rotation !== undefined) {
    if (typeof v.rotation !== 'number' || !Number.isFinite(v.rotation))
      fail(`${at}.rotation 必須是數字(弧度)`)
    rotation = v.rotation
  }

  return {
    raw: v,
    body: {
      lines: parseLines(v.lines, `${at}.lines`),
      x,
      y,
      rotation,
      style: parseTextStyle(v.style, `${at}.style`, fail),
    },
  }
}

/**
 * A source held by nobody is what a fresh object has, so an absent `by` opens
 * as `auto` — not `human`, or every object on a page written by hand would
 * start settled and out of reach of the first run.
 */
function parseSourceBody(v: unknown, at: string): SourceBody {
  const { body, raw } = parseTextBody(v, at)
  const { by, from } = raw
  if (by !== undefined && by !== 'auto' && by !== 'human') fail(`${at}.by 必須是 auto 或 human`)
  const source: SourceBody = { ...body, by: by === 'human' ? 'human' : 'auto' }
  // A birth certificate naming a reading this page no longer holds is kept
  // rather than dropped: it decides nothing, and the day the reading comes back
  // — an undone delete, a reopened project — it means what it always meant.
  if (typeof from === 'string' && from.length > 0) source.from = from
  return source
}

function parseLines(v: unknown, at: string): string[] {
  if (!Array.isArray(v)) fail(`${at} 必須是字串陣列`)
  return v.map((line, j) => {
    if (typeof line !== 'string') fail(`${at}[${j}] 必須是字串`)
    if (/[\r\n]/.test(line)) fail(`${at}[${j}] 不可內嵌換行——斷行請用陣列元素表達`)
    return line
  })
}

function parsePieces(v: unknown, at: string): string[][] {
  if (!Array.isArray(v)) fail(`${at} 必須是陣列`)
  if (v.length === 0) fail(`${at} 至少要有一塊`)
  return v.map((piece, i) => parseLines(piece, `${at}[${i}]`))
}

function parseCandidates(v: unknown, at: string): TranslationCandidate[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${at} 必須是陣列`)
  const seen = new Set<string>()
  return v.map((entry, i) => {
    const where = `${at}[${i}]`
    if (!isRecord(entry)) fail(`${where} 必須是物件`)
    const { id, human, source } = entry
    if (typeof id !== 'string' || id.length === 0) fail(`${where}.id 必須是非空字串`)
    // The slot names one of these, so two of them answering to the same name
    // would make what the unit reads as depend on which was searched first.
    if (seen.has(id)) fail(`${where}.id「${id}」重複`)
    seen.add(id)
    if (human !== undefined && typeof human !== 'boolean') fail(`${where}.human 必須是布林值`)
    if (source !== undefined && (typeof source !== 'string' || source.length === 0))
      fail(`${where}.source 必須是非空字串`)
    const candidate: TranslationCandidate = {
      id,
      pieces: parsePieces(entry.pieces, `${where}.pieces`),
    }
    if (human) candidate.human = true
    if (typeof source === 'string' && source.length > 0) candidate.source = source
    return candidate
  })
}

/**
 * A slot naming a candidate that is not there, or one that no longer has a
 * piece for every block, opens empty rather than failing: the blocks still hold
 * the person's own words, and refusing the page over a pointer that has come
 * loose would cost the translation to protect the choice.
 */
function parseChosen(
  v: unknown,
  pool: readonly TranslationCandidate[],
  blocks: number,
  at: string,
): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string' || v.length === 0) fail(`${at} 必須是非空字串或 null`)
  return pool.some((c) => c.id === v && c.pieces.length === blocks) ? v : null
}

/**
 * ⚠️ `separators` is stored one shorter than `members` and is refused at any
 * other length. A gap count that has to be re-derived on every read is a second
 * place for the two to disagree.
 */
function parseUnitSide(v: unknown, at: string): TranslationUnitSide {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { members, separators } = v
  if (!Array.isArray(members)) fail(`${at}.members 必須是字串陣列`)
  if (members.length === 0) fail(`${at}.members 至少要有一塊`)
  // Naming the same block twice is drift and belongs to repair, which can take
  // the separator beside it out in the same move. Refusing the file here would
  // make a page nobody can open out of one that reads a word twice.
  members.forEach((id, i) => {
    if (typeof id !== 'string' || id.length === 0) fail(`${at}.members[${i}] 必須是非空字串`)
  })
  const gaps = members.length - 1
  if (separators === undefined) return { members: members as string[], separators: Array(gaps).fill('') }
  if (!Array.isArray(separators)) fail(`${at}.separators 必須是字串陣列`)
  if (separators.length !== gaps)
    fail(`${at}.separators 必須有 ${gaps} 個(比 members 少一個),取得 ${separators.length} 個`)
  return {
    members: members as string[],
    separators: separators.map((s, i) => {
      if (typeof s !== 'string') fail(`${at}.separators[${i}] 必須是字串`)
      return s
    }),
  }
}

function parseTranslationUnits(v: unknown, at: string): TranslationUnit[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${at} 必須是陣列`)
  const seen = new Set<string>()
  return v.map((entry, i) => {
    const where = `${at}[${i}]`
    if (!isRecord(entry)) fail(`${where} 必須是物件`)
    const { id } = entry
    if (typeof id !== 'string' || id.length === 0) fail(`${where}.id 必須是非空字串`)
    if (seen.has(id)) fail(`${where}.id「${id}」重複`)
    seen.add(id)
    const translation = parseUnitSide(entry.translation, `${where}.translation`)
    const candidates = parseCandidates(entry.candidates, `${where}.candidates`)
    return {
      id,
      tags: parseTags(entry.tags, `${where}.tags`),
      source: parseUnitSide(entry.source, `${where}.source`),
      translation,
      candidates,
      chosen: parseChosen(entry.chosen, candidates, translation.members.length, `${where}.chosen`),
    }
  })
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
    translationUnits: [],
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
    effects: [],
    name: '底圖',
    file,
    x: 0,
    y: 0,
    w: width,
    h: height,
    alphaLocked: false,
  }
}

/** A body with nothing typed into it, set the way the caller asks. */
export function emptyBody(style: TextStyle): TextBody {
  return { lines: [''], x: 0, y: 0, rotation: 0, style: { ...style } }
}

/** One block with nothing typed into it, on whichever side the caller asks. */
export function blankBlock(
  id: string,
  side: 'source',
  style: TextStyle,
): SourceTextLayerEntry
export function blankBlock(
  id: string,
  side: 'translation',
  style: TextStyle,
): TranslationTextLayerEntry
export function blankBlock(id: string, side: TextSide, style: TextStyle): TextLayerEntry {
  const base: LayerEntryBase & { kind: 'text' } = {
    kind: 'text',
    id,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    effects: [],
  }
  if (side === 'source') return { ...base, side: 'source', body: { ...emptyBody(style), by: 'auto' } }
  return { ...base, side: 'translation', body: emptyBody(style) }
}

export interface BlankTranslation {
  unit: TranslationUnit
  blocks: [SourceTextLayerEntry, TranslationTextLayerEntry]
}

/**
 * A translation with nothing in it: one block a side, and the unit that says
 * they are the same piece of content.
 *
 * ⭐ Unanswered on the source side, and left that way. Which reading a
 * translation stands for is settled once for the whole page, by weighing every
 * reading against every block at once — a block that grabbed the nearest
 * reading as it was drawn would be answering a question the page is about to
 * answer properly, and would have to be overruled to fix it.
 *
 * No tags at all, so a run of them can be placed first and both typed and
 * classified later. Deliberately not inheriting whatever was last selected: a
 * tag put on by the tool rather than by the user is a tag nobody checked.
 */
export function blankTranslation(
  style: TextStyle,
  newId: () => string = generateId,
): BlankTranslation {
  const source = blankBlock(newId(), 'source', style)
  const translation = blankBlock(newId(), 'translation', style)
  return {
    unit: {
      id: newId(),
      tags: [],
      source: { members: [source.id], separators: [] },
      translation: { members: [translation.id], separators: [] },
      candidates: [],
      chosen: null,
    },
    blocks: [source, translation],
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

  if (data.schemaVersion !== MANIFEST_SCHEMA_VERSION && data.schemaVersion !== PLAIN_TEXT_VERSION) {
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

  const manifest: ManifestJson = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    revision,
    name: data.name,
    ...size,
    translationUnits: parseTranslationUnits(data.translationUnits, 'manifest.json.translationUnits'),
    readingOrder,
    readingEdges: parseReadingEdges(data.readingEdges),
    layers,
  }
  if (data.schemaVersion === PLAIN_TEXT_VERSION) {
    for (const block of textObjects(manifest.layers))
      block.body.lines = block.body.lines.map(escapeText)
    for (const unit of manifest.translationUnits)
      for (const candidate of unit.candidates)
        candidate.pieces = candidate.pieces.map((piece) => piece.map(escapeText))
  }
  return manifest
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
  if (l.effects.length > 0) base.effects = serializeEffects(l.effects)
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
  const body = serializeBody(l.body)
  if (l.side === 'source') {
    if (l.body.by !== 'auto') body.by = l.body.by
    if (l.body.from !== undefined) body.from = l.body.from
  }
  return { ...base, side: l.side, body }
}

function serializeUnitSide(side: TranslationUnitSide): Record<string, unknown> {
  const out: Record<string, unknown> = { members: side.members }
  // Left out when every gap is the empty string, which is what lettering split
  // out of one sound wants and so is most of them.
  if (side.separators.some((s) => s.length > 0)) out.separators = side.separators
  return out
}

function serializeUnit(unit: TranslationUnit): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: unit.id,
    source: serializeUnitSide(unit.source),
    translation: serializeUnitSide(unit.translation),
  }
  if (unit.tags.length > 0) out.tags = normalizeTagSet(unit.tags)
  if (unit.candidates.length > 0) out.candidates = unit.candidates
  if (unit.chosen !== null) out.chosen = unit.chosen
  return out
}

function serializeBody(body: TextBody): Record<string, unknown> {
  const out: Record<string, unknown> = { x: body.x, y: body.y, lines: body.lines }
  if (body.rotation) out.rotation = body.rotation
  out.style = serializeTextStyle(body.style)
  return out
}

/**
 * The drawn part of a page, on its own — what a thumbnail's identity is made
 * of.
 *
 * Every source block goes, and so does everything a unit holds: they move no
 * pixel — what a page composites is the translation — and keeping them would
 * throw away every thumbnail in the chapter for a pass that changed nothing
 * anybody can see.
 *
 * A translation block collapses to the words it reads as, chosen candidate
 * resolved: the one in the slot is on the artwork, the rest are proposals
 * nobody can see — two pages reading the same way are the same picture.
 */
export function serializeDrawnLayers(m: ManifestJson): string {
  const drawn = (entry: LayerEntry): Record<string, unknown> | null => {
    if (entry.kind === 'group') {
      const children = entry.children.map(drawn).filter((c) => c !== null)
      return { ...serializeLayerEntry(entry), children }
    }
    if (entry.kind !== 'text') return serializeLayerEntry(entry)
    if (entry.side === 'source') return null
    const out = serializeLayerEntry(entry)
    const place = placeOfBlock(m, entry.id)
    const body = out.body as Record<string, unknown>
    body.lines =
      place === undefined
        ? entry.body.lines
        : linesAt(place.unit, place.at, entry.body.lines)
    return out
  }
  return JSON.stringify(m.layers.map(drawn).filter((l) => l !== null))
}

export function serializeManifest(m: ManifestJson): string {
  const out: Record<string, unknown> = {
    schemaVersion: m.schemaVersion,
    revision: m.revision,
    name: m.name,
    width: m.width,
    height: m.height,
  }
  out.translationUnits = m.translationUnits.map(serializeUnit)
  out.readingOrder = m.readingOrder
  if (m.readingEdges.length > 0) out.readingEdges = normalizeEdges(m.readingEdges)
  out.layers = m.layers.map(serializeLayerEntry)
  return `${JSON.stringify(out, null, 2)}\n`
}



function parseOcrCandidate(v: unknown, i: number): OcrCandidatePersisted {
  const at = `candidates[${i}]`
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const { hash, source, text, original, x, y, w, h, confidence, label } = v
  const { vertical, fontSizePx, leadingPercent, setAside } = v

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

  const candidate: OcrCandidatePersisted = {
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

  // Absent stays absent rather than becoming a default: a reading made before
  // anything measured the type has no measurement, and saying otherwise would
  // let a guess be read as an observation. A value that is there but is not a
  // number is dropped for the same reason.
  if (typeof vertical === 'boolean') candidate.vertical = vertical
  if (typeof fontSizePx === 'number' && Number.isFinite(fontSizePx) && fontSizePx > 0)
    candidate.fontSizePx = fontSizePx
  if (typeof leadingPercent === 'number' && Number.isFinite(leadingPercent) && leadingPercent > 0)
    candidate.leadingPercent = leadingPercent
  // Only the true one is kept, so an entry nobody has turned down carries
  // nothing — and so that a `false` written by some older hand reads the same
  // as never having been said.
  if (setAside === true) candidate.setAside = true
  return candidate
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
