import type {
  GroupLayerEntry,
  LayerEntry,
  LayerEntryBase,
  Ledger,
  ManifestJson,
  OcrCandidatePersisted,
  OcrJson,
  RasterLayerEntry,
  SourceBody,
  SourceTextLayerEntry,
  TextBody,
  TextLayerEntry,
  TranslationBody,
  TranslationCandidate,
  TranslationTextLayerEntry,
  TranslationUnit,
} from './types'
import { MANIFEST_SCHEMA_VERSION, OCR_SCHEMA_VERSION, PASS_THROUGH } from './types'
import { normalizeEdges, type ReadingEdge } from './readingGraph'
import { linesOf } from './text'
import { BLOCK_JOINER, shownCodeOf } from './units'
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

/**
 * Every version this parser reads. The older two need nothing beyond what the
 * style parser already does with a key that is not there — a character scale
 * absent means the face's own proportions — except for the escaping below.
 */
const READABLE_VERSIONS: readonly unknown[] = [PLAIN_TEXT_VERSION, 14, 15, MANIFEST_SCHEMA_VERSION]

/** The last version that held one ledger for the page, with candidates on the unit. */
const ONE_LEDGER_VERSION = 15


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

function parseTextEntry(v: Record<string, unknown>, at: string, legacyFace: string | null): TextLayerEntry {
  const base = parseLayerBase(v, at, 'text')
  const { side } = v
  if (side !== 'source' && side !== 'translation')
    fail(`${at}.side 必須是 source 或 translation(取得 ${JSON.stringify(side)})`)
  if (side === 'source')
    return { kind: 'text', ...base, side, body: parseSourceBody(v.body, `${at}.body`) }
  let face = legacyFace
  if (face === null) {
    if (typeof v.face !== 'string' || v.face.length === 0) fail(`${at}.face 必須是非空字串`)
    face = v.face
  }
  return { kind: 'text', ...base, side, face, body: parseTranslationBody(v.body, `${at}.body`) }
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
  const source: SourceBody = {
    ...body,
    by: by === 'human' ? 'human' : 'auto',
    tags: parseTags(raw.tags, `${at}.tags`),
  }
  // A birth certificate naming a reading this page no longer holds is kept
  // rather than dropped: it decides nothing, and the day the reading comes back
  // — an undone delete, a reopened project — it means what it always meant.
  if (typeof from === 'string' && from.length > 0) source.from = from
  return source
}

/**
 * A slot naming a candidate that is not in the pool opens empty rather than
 * failing: the block still holds the person's own words, and refusing the page
 * over a pointer that has come loose would cost the words to protect the choice.
 */
function parseTranslationBody(v: unknown, at: string): TranslationBody {
  const { body, raw } = parseTextBody(v, at)
  const candidates = parseCandidates(raw.candidates, `${at}.candidates`)
  const { chosen } = raw
  if (chosen !== undefined && chosen !== null && (typeof chosen !== 'string' || chosen.length === 0))
    fail(`${at}.chosen 必須是非空字串或 null`)
  const held = typeof chosen === 'string' && candidates.some((c) => c.id === chosen) ? chosen : null
  return { ...body, candidates, chosen: held }
}

function parseLines(v: unknown, at: string): string[] {
  if (!Array.isArray(v)) fail(`${at} 必須是字串陣列`)
  return v.map((line, j) => {
    if (typeof line !== 'string') fail(`${at}[${j}] 必須是字串`)
    if (/[\r\n]/.test(line)) fail(`${at}[${j}] 不可內嵌換行——斷行請用陣列元素表達`)
    return line
  })
}

function parseCandidateMarks(entry: Record<string, unknown>, where: string): Pick<TranslationCandidate, 'id' | 'human' | 'source'> {
  const { id, human, source } = entry
  if (typeof id !== 'string' || id.length === 0) fail(`${where}.id 必須是非空字串`)
  if (human !== undefined && typeof human !== 'boolean') fail(`${where}.human 必須是布林值`)
  if (source !== undefined && (typeof source !== 'string' || source.length === 0))
    fail(`${where}.source 必須是非空字串`)
  const out: Pick<TranslationCandidate, 'id' | 'human' | 'source'> = { id }
  if (human) out.human = true
  if (typeof source === 'string' && source.length > 0) out.source = source
  return out
}

function parseCandidates(v: unknown, at: string): TranslationCandidate[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${at} 必須是陣列`)
  const seen = new Set<string>()
  return v.map((entry, i) => {
    const where = `${at}[${i}]`
    if (!isRecord(entry)) fail(`${where} 必須是物件`)
    const marks = parseCandidateMarks(entry, where)
    // The slot names one of these, so two of them answering to the same name
    // would make what the block reads as depend on which was searched first.
    if (seen.has(marks.id)) fail(`${where}.id「${marks.id}」重複`)
    seen.add(marks.id)
    return { ...marks, lines: parseLines(entry.lines, `${where}.lines`) }
  })
}

function parseIdList(v: unknown, at: string): string[] {
  if (!Array.isArray(v)) fail(`${at} 必須是字串陣列`)
  return v.map((id, i) => {
    if (typeof id !== 'string' || id.length === 0) fail(`${at}[${i}] 必須是非空字串`)
    return id
  })
}

/**
 * Naming the same block twice is drift and belongs to repair. Refusing the file
 * here would make a page nobody can open out of one that reads a word twice.
 */
function parseUnits(v: unknown, at: string): TranslationUnit[] {
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
    return { id, members: parseIdList(entry.members, `${where}.members`) }
  })
}

function parseLedger(v: unknown, at: string): Ledger {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  return {
    units: parseUnits(v.units, `${at}.units`),
    readingOrder: parseIdList(v.readingOrder ?? [], `${at}.readingOrder`),
    readingEdges: parseReadingEdges(v.readingEdges, `${at}.readingEdges`),
  }
}

function parseLedgers(v: unknown): Record<string, Ledger> {
  if (v === undefined) return {}
  if (!isRecord(v)) fail('manifest.json.ledgers 必須是物件')
  const out: Record<string, Ledger> = {}
  for (const [face, ledger] of Object.entries(v)) {
    if (face.length === 0) fail('manifest.json.ledgers 的 key 必須是非空字串')
    out[face] = parseLedger(ledger, `manifest.json.ledgers.${face}`)
  }
  return out
}

/**
 * One unit as a page of the single-ledger format held it: two lists, the gap
 * between blocks, and a pool of candidates each cut into one piece per block.
 */
interface LegacyUnit {
  id: string
  tags: string[]
  source: string[]
  translation: string[]
  candidates: (Pick<TranslationCandidate, 'id' | 'human' | 'source'> & { pieces: string[][] })[]
  chosen: string | null
}

function parseLegacyUnits(v: unknown, at: string): LegacyUnit[] {
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
    const side = (s: unknown, name: string): string[] => {
      if (!isRecord(s)) fail(`${where}.${name} 必須是物件`)
      return parseIdList(s.members, `${where}.${name}.members`)
    }
    const pool = entry.candidates === undefined ? [] : entry.candidates
    if (!Array.isArray(pool)) fail(`${where}.candidates 必須是陣列`)
    const candidates = pool.map((c, j) => {
      const at2 = `${where}.candidates[${j}]`
      if (!isRecord(c)) fail(`${at2} 必須是物件`)
      if (!Array.isArray(c.pieces) || c.pieces.length === 0) fail(`${at2}.pieces 至少要有一塊`)
      return {
        ...parseCandidateMarks(c, at2),
        pieces: c.pieces.map((p, k) => parseLines(p, `${at2}.pieces[${k}]`)),
      }
    })
    const { chosen } = entry
    return {
      id,
      tags: parseTags(entry.tags, `${where}.tags`),
      source: side(entry.source, 'source'),
      translation: side(entry.translation, 'translation'),
      candidates,
      chosen: typeof chosen === 'string' && candidates.some((c) => c.id === chosen) ? chosen : null,
    }
  })
}

/**
 * The single-ledger page brought into the face's ledger.
 *
 * A candidate with one piece per block is dealt out, piece by piece, to the
 * blocks in their order — the order it was written against. One that no longer
 * fits, which a deleted block used to leave behind, has nowhere else its words
 * can go: joined, it becomes the first block's candidate, so whatever was typed
 * into it is choosable again rather than stranded.
 */
function migrateLegacyUnits(layers: LayerEntry[], units: LegacyUnit[], face: string): TranslationUnit[] {
  const blocks = new Map(textObjects(layers).map((t) => [t.id, t]))
  return units.map((unit) => {
    for (const id of unit.source) {
      const block = blocks.get(id)
      if (block?.side === 'source') block.body.tags = normalizeTagSet([...block.body.tags, ...unit.tags])
    }
    const lettering = unit.translation
      .map((id) => blocks.get(id))
      .filter((b): b is TranslationTextLayerEntry => b?.side === 'translation' && b.face === face)
    for (const candidate of unit.candidates) {
      const { pieces, ...marks } = candidate
      const chosen = unit.chosen === candidate.id
      if (pieces.length === lettering.length) {
        lettering.forEach((block, at) => {
          block.body.candidates.push({ ...marks, lines: pieces[at]! })
          if (chosen) block.body.chosen = candidate.id
        })
      } else if (lettering[0] !== undefined) {
        lettering[0].body.candidates.push({
          ...marks,
          lines: linesOf(pieces.map((p) => p.join('\n')).join(BLOCK_JOINER)),
        })
        if (chosen) lettering[0].body.chosen = candidate.id
      }
    }
    return { id: unit.id, members: [...unit.source, ...unit.translation] }
  })
}

function parseGroupEntry(v: Record<string, unknown>, at: string, legacyFace: string | null): GroupLayerEntry {
  const base = parseLayerBase(v, at, 'group')
  const name = parseName(v, at)
  const { children } = v
  if (!Array.isArray(children)) fail(`${at}.children 必須是陣列`)
  const parsedChildren = children.map((c, i) => parseLayerEntry(c, `${at}.children[${i}]`, legacyFace))
  return { kind: 'group', ...base, name, children: parsedChildren }
}

function parseLayerEntry(v: unknown, at: string, legacyFace: string | null): LayerEntry {
  if (!isRecord(v)) fail(`${at} 必須是物件`)
  const kind = v.kind
  if (kind === 'raster') return parseRasterEntry(v, at)
  if (kind === 'text') return parseTextEntry(v, at, legacyFace)
  if (kind === 'group') return parseGroupEntry(v, at, legacyFace)
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
    ledgers: {},
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

/** What the working copy a new page puts over its base map is called. */
export const RETOUCH_LAYER_NAME = '修圖'

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

/** One block of the artwork's words with nothing typed into it. */
export function blankSourceBlock(id: string, style: TextStyle): SourceTextLayerEntry {
  return { ...blankBase(id), side: 'source', body: { ...emptyBody(style), by: 'auto', tags: [] } }
}

/** One block of a face's lettering with nothing typed into it. */
export function blankTranslationBlock(id: string, face: string, style: TextStyle): TranslationTextLayerEntry {
  return { ...blankBase(id), side: 'translation', face, body: { ...emptyBody(style), candidates: [], chosen: null } }
}

function blankBase(id: string): LayerEntryBase & { kind: 'text' } {
  return { kind: 'text', id, visible: true, locked: false, opacity: 1, blendMode: 'normal', effects: [] }
}

/** A new sentence's blocks and, for every face, the unit that holds them. */
export interface BlankTranslation {
  blocks: TextLayerEntry[]
  units: Record<string, TranslationUnit>
}

/**
 * A sentence with nothing in it: one block of the artwork's words, one block of
 * lettering for every face, and in every face's ledger the unit holding its two.
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
  faces: readonly string[],
  newId: () => string = generateId,
): BlankTranslation {
  const source = blankSourceBlock(newId(), style)
  const blocks: TextLayerEntry[] = [source]
  const units: Record<string, TranslationUnit> = {}
  for (const face of faces) {
    const lettering = blankTranslationBlock(newId(), face, style)
    blocks.push(lettering)
    units[face] = { id: newId(), members: [source.id, lettering.id] }
  }
  return { blocks, units }
}

/**
 * An object pointed at itself is refused here rather than left to repair,
 * unlike an end that names nothing: a self-reference cannot be a page whose
 * parts have drifted apart, only a file describing something that has no
 * meaning to have.
 */
function parseReadingEdges(v: unknown, where: string): ReadingEdge[] {
  if (v === undefined) return []
  if (!Array.isArray(v)) fail(`${where} 必須是陣列`)
  return normalizeEdges(
    v.map((entry, i) => {
      const at = `${where}[${i}]`
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
 * Structure only. Whether a ledger and the tree agree with each other is the
 * repair layer's question, not this one — a page whose order has drifted is
 * still readable, and refusing to open it would be the worse answer.
 *
 * `legacyFace` is the project's face that a page from before faces belongs to:
 * its lettering takes that face, and its one ledger becomes that face's.
 */
export function parseManifest(raw: string, legacyFace: string): ManifestJson {
  const data = parseJson(raw, 'manifest.json')
  if (!isRecord(data)) fail('manifest.json 頂層必須是物件')

  if (!READABLE_VERSIONS.includes(data.schemaVersion)) {
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > MANIFEST_SCHEMA_VERSION)
      fail(`manifest.json 由較新版本建立(schemaVersion ${data.schemaVersion}),請更新軟體`)
    fail(`不支援的 manifest.json 版本:${JSON.stringify(data.schemaVersion)}`)
  }
  const legacy = (data.schemaVersion as number) <= ONE_LEDGER_VERSION

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

  const layersRaw = data.layers
  if (!Array.isArray(layersRaw)) fail('manifest.json.layers 必須是陣列')
  const layers = layersRaw.map((l, i) => parseLayerEntry(l, `layers[${i}]`, legacy ? legacyFace : null))

  const files: string[] = []
  collectRasterFiles(layers, files)
  if (new Set(files).size !== files.length) fail('manifest.json.layers[].file 不可重複')

  if (data.schemaVersion === PLAIN_TEXT_VERSION) {
    for (const block of textObjects(layers)) block.body.lines = block.body.lines.map(escapeText)
  }

  let ledgers: Record<string, Ledger>
  if (legacy) {
    const units = parseLegacyUnits(data.translationUnits, 'manifest.json.translationUnits')
    if (data.schemaVersion === PLAIN_TEXT_VERSION)
      for (const unit of units)
        for (const candidate of unit.candidates)
          candidate.pieces = candidate.pieces.map((piece) => piece.map(escapeText))
    ledgers = {
      [legacyFace]: {
        units: migrateLegacyUnits(layers, units, legacyFace),
        readingOrder: parseIdList(data.readingOrder ?? [], 'manifest.json.readingOrder'),
        readingEdges: parseReadingEdges(data.readingEdges, 'manifest.json.readingEdges'),
      },
    }
  } else {
    ledgers = parseLedgers(data.ledgers)
  }

  return { schemaVersion: MANIFEST_SCHEMA_VERSION, revision, name: data.name, ...size, ledgers, layers }
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
    if (l.body.tags.length > 0) body.tags = normalizeTagSet(l.body.tags)
    return { ...base, side: l.side, body }
  }
  if (l.body.candidates.length > 0) body.candidates = l.body.candidates
  if (l.body.chosen !== null) body.chosen = l.body.chosen
  return { ...base, side: l.side, face: l.face, body }
}

function serializeLedger(ledger: Ledger): Record<string, unknown> {
  const out: Record<string, unknown> = {
    units: ledger.units.map((u) => ({ id: u.id, members: u.members })),
    readingOrder: ledger.readingOrder,
  }
  if (ledger.readingEdges.length > 0) out.readingEdges = normalizeEdges(ledger.readingEdges)
  return out
}

function serializeBody(body: TextBody): Record<string, unknown> {
  const out: Record<string, unknown> = { x: body.x, y: body.y, lines: body.lines }
  if (body.rotation) out.rotation = body.rotation
  out.style = serializeTextStyle(body.style)
  return out
}

/**
 * The drawn part of a page as one face exports it, on its own — what a
 * thumbnail's identity is made of.
 *
 * Every source block goes, and so does every other face's lettering and every
 * ledger: they move no pixel of this face's page, and keeping them would throw
 * away every thumbnail in the chapter for a pass that changed nothing anybody
 * can see.
 *
 * A block collapses to the words it reads as, chosen candidate resolved: the
 * one in the slot is on the artwork, the rest are proposals nobody can see.
 */
export function serializeDrawnLayers(m: ManifestJson, face: string): string {
  const drawn = (entry: LayerEntry): Record<string, unknown> | null => {
    if (entry.kind === 'group') {
      const children = entry.children.map(drawn).filter((c) => c !== null)
      return { ...serializeLayerEntry(entry), children }
    }
    if (entry.kind !== 'text') return serializeLayerEntry(entry)
    if (entry.side === 'source' || entry.face !== face) return null
    const out = serializeLayerEntry(entry)
    const body = out.body as Record<string, unknown>
    body.lines = linesOf(shownCodeOf(entry))
    delete body.candidates
    delete body.chosen
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
  out.ledgers = Object.fromEntries(Object.entries(m.ledgers).map(([face, l]) => [face, serializeLedger(l)]))
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
