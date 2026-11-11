import type { LayerEffect } from '../effects/types'
import type { TextStyle } from '../text-style/types'
import type { ReadingEdge } from './readingGraph'


export const MANIFEST_SCHEMA_VERSION = 19

export const OCR_SCHEMA_VERSION = 2

/**
 * A folder with no blending of its own: its children meet whatever is under the
 * folder directly, so nothing has to be composited into a buffer first. Carried
 * as a value of the blend-mode list rather than a flag of its own, as in
 * Photoshop, where it is a group's default.
 */
export const PASS_THROUGH = 'pass-through'

export interface LayerEntryBase {

  id: string
  visible: boolean
  locked: boolean

  /**
   * [0,1]. Concrete here where the persisted form leaves it out at 1, so
   * nothing downstream has to keep asking whether an absent value means opaque.
   */
  opacity: number

  /** Concrete for the same reason. A folder's default is `PASS_THROUGH`. */
  blendMode: string

  /**
   * What this node carries on top of what it is — a stroke, today.
   *
   * On the base rather than on the text object, because what is added on top of
   * a node is a property of the node: a raster layer has no style to hang one
   * off and still has an edge to grow a band from. Concrete like the two above,
   * empty being both the default and what the persisted form leaves out.
   *
   * ⚠️ Composited rather than baked. Nothing here changes the node's own
   * pixels — turning a stroke off returns the layer byte for byte, and a text
   * object is never rasterized into the page.
   */
  effects: LayerEffect[]
}


export interface RasterLayerEntry extends LayerEntryBase {
  kind: 'raster'
  name: string

  file: string

  /**
   * The layer's own frame in whole page pixels; its PNG covers this and no
   * more. A full-page buffer is 12 MB decoded however well it compressed, and
   * one erase patch per region would spend that twenty times over on a page
   * that is mostly transparent.
   *
   * A layer nothing has been written to yet has no frame, which is `w` and `h`
   * at zero. The first write places the frame and later ones grow it.
   */
  x: number
  y: number
  w: number
  h: number

  alphaLocked: boolean
}


/**
 * The words one block carries — what the artwork says, or what it will say —
 * and everything about how they sit on the page.
 *
 * ⭐ The two sides are the same kind of thing. What was once the object's own
 * position, angle and style belonged to the translation alone, which made the
 * source a lesser field of it — able to hold words and nothing else, borrowing
 * typesetting decisions made about a different sentence.
 *
 * A third language would be a third side of a unit, holding these same blocks.
 * Nothing here is keyed by language yet, because two is what there is.
 */
export interface TextBody {
  /** One entry per line; an embedded newline is refused at parse. */
  lines: string[]

  /**
   * Where this body stands on the page, in page pixels, and free to fall
   * between two of them.
   *
   * A raster layer's frame is whole pixels because its content *is* cells and
   * there is nothing else it could be. Typeset text is not: the pixels a reader
   * sees are a rasterization of outlines, so a whole number here would be a
   * property of that output written back onto the input, losing both the
   * precision and the fact that anything was lost.
   *
   * Which point of the frame this names is not stored: it follows from the
   * style's alignment, since a block with no frame of its own has nothing
   * between the edge its lines are aligned to and the edge of the block itself.
   */
  x: number
  y: number

  /**
   * This body's own turn on the page, in radians, clockwise. Concrete here
   * where the persisted form leaves it out at zero, so nothing downstream has
   * to keep asking whether an absent turn means upright.
   *
   * Its own, like its position: the angle a sentence was written on the artwork
   * is a measurement, and the angle a translation is set at is a decision.
   */
  rotation: number

  /**
   * Mirrored along the frame's own horizontal or vertical, about the point the
   * position names — so the text that point anchors stays put while the rest
   * of it grows the other way. Absent is not mirrored.
   */
  flipX?: boolean
  flipY?: boolean

  /**
   * The whole style, held by value — no group to inherit from and no override
   * layered on top. Two bodies that look alike are two bodies that hold the
   * same nine fields, and nothing changes what one of them looks like except
   * writing to it.
   *
   * The cost is that making a hundred objects agree means writing to a hundred
   * of them. That is what the batch operations are for, and it is paid on
   * purpose: it buys back the case a shared style cannot express, where one
   * object needs to leave the group it belongs to without leaving what it means.
   */
  style: TextStyle
}


export type SourceHand = 'auto' | 'human'

/**
 * What the artwork says here, in this object's own words.
 *
 * ⚠️ The only body the recognizers reach, and the whole of what is still
 * special about it. Everything else it can do, the translation can do too.
 */
export interface SourceBody extends TextBody {
  /**
   * ⚠️ What keeps a rerun from overruling a person. An automatic pass may only
   * write where this is `auto`; where it is `human` the source is settled,
   * including when it is settled on nothing.
   */
  by: SourceHand

  /**
   * Which reading in this page's `ocr.json` these words came from, when they
   * came from one.
   *
   * ⭐ A birth certificate and nothing more. The words above are the text —
   * this only says where they were got, so a reading that has since gone
   * leaves the object saying exactly what it said.
   *
   * ⭐ And the edge hangs here, on the many side, so that deleting an object,
   * undoing that delete, correcting the words by hand and a rerun finding
   * something new all come out right with no code to keep any of it in step.
   * See `shared/ocr/offer.ts`.
   */
  from?: string

  /**
   * What this text is, semantically, as tag names. A sorted set.
   *
   * On the artwork's words rather than on any translation of them: every face
   * groups the source into sentences its own way, and what a balloon means is
   * one fact about the balloon whichever face is reading it. A sentence's tags
   * are the union of its source blocks'.
   *
   * Any string is a legal tag. `project.tags` colours the ones it knows and
   * says nothing about the rest.
   */
  tags: string[]
}

/**
 * One way one block could read.
 *
 * ⚠️ Only what a person wrote carries a mark. A model spends no tokens saying
 * who it is, and the rule that protects the work is stated the other way round:
 * a marked candidate may not be edited, only appended after.
 */
export interface TranslationCandidate {
  id: string
  /** Its short name in its block's drawer, shown as a letter: 1 is `a`. Never reissued. */
  no?: number
  lines: string[]
  human?: boolean
  /**
   * Who proposed this — the MCP handshake's clientInfo, stamped by the server.
   * Display only: the mark that protects work is `human`, never this.
   */
  source?: string
}

/**
 * A block of lettering's words: the ones typed into it, and the pool it can
 * read from instead.
 *
 * ⭐ The pool hangs on the block, so a block keeps its words whatever happens to
 * the sentence around it — removed, reordered, regrouped. A translation set in
 * two blocks in one face and three in another has no candidate that could
 * speak for the whole of it.
 */
export interface TranslationBody extends TextBody {
  candidates: TranslationCandidate[]
  /**
   * Which candidate this block reads as, or null for its own lines. A pointer
   * and not a copy: picking never overwrites what was typed.
   */
  chosen: string | null
}

/**
 * One block of text on the page — the manifest holds it rather than pointing
 * at a copy of it elsewhere, so creating or deleting one is a single atomic
 * write and an orphan cannot exist.
 *
 * It has no name. The tree and the label list are two views of these same
 * objects, and a name anyone could edit would let one object read differently
 * in each while drifting from the translation it stands for.
 *
 * ⭐ One side and one body. Which sentence this block belongs to is not written
 * here: each face's ledger holds the lists, so membership is one fact in one
 * place — and a source block, which every face groups its own way, can belong
 * to a different sentence in each.
 */
interface TextLayerEntryBase extends LayerEntryBase {
  kind: 'text'
  /**
   * The block's short name, issued by its container and never reissued there:
   * the page for the artwork's words, the sentence for a face's lettering.
   * Absent only between a block being made and the page being numbered.
   */
  no?: number
}

/** One block of what the artwork says. */
export interface SourceTextLayerEntry extends TextLayerEntryBase {
  side: 'source'
  body: SourceBody
}

/** One block of what a face will say. */
export interface TranslationTextLayerEntry extends TextLayerEntryBase {
  side: 'translation'
  /** Which translation face this block belongs to — a project-wide id. */
  face: string
  /**
   * The sentence that issued `no`. A block found in any other sentence has
   * changed container and is given a number there.
   */
  numberedIn?: string
  body: TranslationBody
}

export type TextLayerEntry = SourceTextLayerEntry | TranslationTextLayerEntry

/**
 * A folder. It means nothing to the translation, but it does carry the base's
 * blending, so a run of layers can be dimmed or multiplied as one unit.
 */
export interface GroupLayerEntry extends LayerEntryBase {
  kind: 'group'
  name: string
  children: LayerEntry[]
}

export type LayerEntry = RasterLayerEntry | TextLayerEntry | GroupLayerEntry

/**
 * One entry in a face's ledger: these blocks of artwork and those blocks of
 * lettering are the same piece of content.
 *
 * ⭐ It draws nothing and claims no pairing between individual blocks. The
 * order of `members` is the order the sentence is read in and the order the
 * label list shows it — and nothing else: no candidate, no other face and no
 * gap between blocks is addressed by position.
 *
 * Both kinds of block share the one list; a block's own `side` says which it
 * is, so the list cannot disagree with it.
 */
export interface TranslationUnit {
  id: string
  /** The sentence's short name in its face, issued by the page and never reissued. */
  no?: number
  members: string[]
}

/**
 * How one translation face cuts the page into sentences.
 *
 * One per face, because each language groups the artwork's words its own way:
 * two balloons may be one sentence in one face and two in another, which is a
 * translation decision and not something faces can share. Every source block
 * belongs to exactly one unit of every ledger; a face's blocks belong to exactly
 * one unit of its own. Which sentence is read first is not here: that is the
 * page's, and a face reads it through its sentences (see `reading.ts`).
 */
export interface Ledger {
  units: TranslationUnit[]
}


export interface ManifestJson {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION

  revision: number

  /**
   * What the page is called in the interface. Its directory name is its
   * identity and never moves, so this is free to be anything the user likes and
   * free to be the same as another page's — renaming writes this field and
   * touches no file.
   */
  name: string

  /**
   * The page's own pixel grid, settled when the page was created.
   *
   * Every position on the page is measured in these, so nothing can be drawn
   * without them — which is why they are not optional and not discovered. There
   * is no image behind the page to ask any more: the base map is a layer like
   * any other, free to be hidden, moved or deleted.
   */
  width: number
  height: number

  /**
   * Each translation face's reading of the page, keyed by face id. Held beside
   * the tree rather than in it: the tree expresses z-order and containment, and
   * a sentence is neither.
   */
  ledgers: Record<string, Ledger>

  /**
   * The artwork's words in the order a reader meets them, by block id. Every
   * face orders its sentences from this; a block it does not name reads after
   * the ones it does.
   */
  readingOrder: string[]

  /**
   * Lines between blocks of the artwork's words, each saying that one is read
   * before another. Empty is the ordinary state. ⚠️ No line does not mean read
   * together — it means nobody has said. See `readingGraph.ts`.
   */
  readingEdges: ReadingEdge[]

  /**
   * The next number each container issues. Kept outside the ledgers and the
   * tree, which are what undo writes back: a counter undo could rewind would
   * hand out a number something has already worn.
   */
  counters: NumberCounters

  /**
   * The page's own materials: the base map and the retouch layer it was made
   * with, layers a face promoted, and the artwork's words. What the source side
   * shows, and nothing of any face's.
   */
  pageTree: LayerEntry[]

  /**
   * Each face's own document, keyed by face id: its layers, folders and
   * lettering, with every entry of `pageTree` placed among them. A page entry
   * is the same object here as there — a face decides where the page's
   * materials stand in its stack and which of its folders hold them, and
   * nothing else about them. See `trees.ts`.
   */
  faceTrees: Record<string, LayerEntry[]>
}

/**
 * Each entry is the next number that container hands out. Containers that are
 * gone keep their entry: undo can bring one back, and it must not then reissue
 * a number it already gave.
 */
export interface NumberCounters {
  /** Blocks of the artwork's words, issued by the page. */
  source: number
  /** Sentences, by face id. */
  units: Record<string, number>
  /** A face's lettering, by the id of the sentence that issues it. */
  blocks: Record<string, number>
  /** Candidates, by the id of the block whose drawer they are in. */
  candidates: Record<string, number>
}



/**
 * One thing a recognizer read off this page's artwork, kept.
 *
 * ⚠️ This file is no longer a cache of the last run. Its entries can be
 * corrected by hand and text objects point at them, so throwing it away throws
 * away work. What can still be thrown away freely is any entry nothing points
 * at — those really are just the last measurement.
 */
export interface OcrCandidatePersisted {
  /**
   * Fixed when the entry was created and never recomputed, so that correcting
   * the text below does not move it. See `shared/ocr/identity.ts`.
   */
  hash: string

  /**
   * Which recognizer said this. Unconstrained: the set of routes is expected
   * to grow, and a name this file has never heard is still worth keeping.
   */
  source: string

  /**
   * What it says now, which anyone may correct.
   *
   * Line breaks belong in here. Two of the four readers can say where the
   * artwork broke a sentence, and where it broke is as much a part of what is
   * written as a character is — an object made from this reading should look
   * like the balloon it was read out of without anybody rewrapping it.
   */
  text: string

  /**
   * What it said when it was created. Kept for every entry rather than only
   * for corrected ones, so that "has anyone touched this" is a comparison
   * rather than a second field to maintain.
   */
  original: string

  /**
   * Where it was read, in the page's own pixels, as of its creation. It does
   * not follow a later run: this geometry is what the entry falls back to when
   * it leaves a text object, and a moving target would land it somewhere it
   * was never read.
   */
  x: number
  y: number
  w: number
  h: number

  /**
   * How sure the recognizer was, as a mean probability per character. Every
   * route reports this the same way, which is the only reason two of them can
   * be compared at all.
   */
  confidence: number

  /**
   * What the detector called the region this was read from — `text_bubble`
   * and the rest, or `line` for one that only a line detector ever saw.
   * Unconstrained for the same reason `source` is.
   */
  label: string

  /**
   * How the region this was read from was set, as one run measured it.
   *
   * ⭐ On the reading rather than on a text object, so one measurement can
   * furnish more than one body — the day a page carries a second language, both
   * of them are set the way this balloon is set.
   *
   * ⚠️ Absent, not defaulted, on a reading made before anything measured this.
   * A default here would be this file answering a question nobody asked it.
   *
   * ⚠️ And deliberately no part of the identity: the head that produces these
   * is a regression and will answer a hair differently next time, so folding
   * them into the identity would make every rerun add the whole page again.
   */
  vertical?: boolean
  fontSizePx?: number
  /** Baseline to baseline, as a percentage of the type size. */
  leadingPercent?: number

  /**
   * Somebody said this page has no use for this reading.
   *
   * ⭐ Saved, and so is the whole point. It used to be a note in memory that
   * went when the project was closed, which meant an afternoon of clearing a
   * page came back the next morning. Two of the four recognizers read the same
   * balloon a character apart; the loser has to be dismissable for good, or it
   * stands beside a settled balloon for ever.
   *
   * ⚠️ It says nothing about the words. A reading set aside is still what a
   * model read, and an object made from it before it was set aside keeps saying
   * what it says. This only takes it off the list of things still being offered
   * — and out of the page's next decision, which must not weigh a reading
   * somebody has already turned down.
   *
   * Absent rather than false on the ordinary reading, so a page of them carries
   * nothing extra.
   */
  setAside?: boolean
}

export interface OcrJson {
  schemaVersion: typeof OCR_SCHEMA_VERSION

  width: number
  height: number
  candidates: OcrCandidatePersisted[]
}
