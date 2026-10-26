import type { LayerEffect } from '../effects/types'
import type { TextStyle } from '../text-style/types'
import type { ReadingEdge } from './readingGraph'


export const MANIFEST_SCHEMA_VERSION = 14

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
 * ⭐ One side and one body. Which translation this block belongs to is not
 * written here: `ManifestJson.translationUnits` holds the lists, so a block's
 * place in a translation is one fact in one place rather than a number on each
 * block that every insertion and deletion would have to renumber.
 */
interface TextLayerEntryBase extends LayerEntryBase {
  kind: 'text'
}

/** One block of what the artwork says. */
export interface SourceTextLayerEntry extends TextLayerEntryBase {
  side: 'source'
  body: SourceBody
}

/**
 * One block of what the page will say.
 *
 * The words it could say instead are not here. A candidate is a whole
 * translation and a block is a typesetting decision about one, so the pool
 * hangs on the unit — see `TranslationUnit.candidates`.
 */
export interface TranslationTextLayerEntry extends TextLayerEntryBase {
  side: 'translation'
  body: TextBody
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
 * One way a translation could read, whole.
 *
 * ⚠️ Only what a person wrote carries a mark. A model spends no tokens saying
 * who it is, and the rule that protects the work is stated the other way round:
 * a marked candidate may not be edited, only appended after.
 */
export interface TranslationCandidate {
  id: string

  /**
   * The words, one array of lines per block this reading wants to be set in.
   * One block is the ordinary shape, and the only one anybody types by hand.
   *
   * ⭐ Cutting a sentence into blocks is a decision about the artwork, not
   * about the language, so a model has no reason to reach for it — the escape
   * hatch is here because a surface that cannot express it at all is a surface
   * that would have to be widened later, not because it will be used.
   */
  pieces: string[][]

  human?: boolean

  /**
   * Who proposed this, for telling drawers apart — the MCP handshake's
   * clientInfo, stamped by the server, costing the model nothing. Display
   * only: the mark that protects work is `human`, never this.
   */
  source?: string
}

/**
 * One side of a translation: which blocks say it, in the order they are read.
 *
 * The array position *is* the order. Held here rather than as a number on each
 * block, so that removing one is a splice and no state where the numbering has
 * a hole or a repeat can be written down at all.
 */
export interface TranslationUnitSide {
  /**
   * At least one, always. A unit missing a side is not a translation, and a
   * blank block is how a side with nothing in it yet says so — the same way an
   * untranslated balloon has always been an object holding no words.
   */
  members: string[]

  /**
   * What goes between one block and the next when the side is read as one
   * stretch of text. One shorter than `members`.
   *
   * Empty string for lettering split out of one sound, which is the case this
   * exists for; a narration broken across two blocks may want a space. Stored
   * rather than assumed, because whether there is a space there is something a
   * person decided.
   */
  separators: string[]
}

/**
 * One entry in the translation ledger: these blocks of artwork and those blocks
 * of lettering are the same piece of content.
 *
 * ⭐ It draws nothing. No transform, no visibility, no blending, no effects —
 * the page never composites this, and every question about how something looks
 * is answered by the blocks themselves. What it owns is the identity: the row
 * in the label list, the place in the reading order, and what the content
 * means.
 *
 * ⚠️ It says nothing about which source block goes with which translation
 * block. A sound written as one word and lettered as two is not a claim that
 * half of it means 轟.
 */
export interface TranslationUnit {
  id: string

  /**
   * What this is, semantically — 框内, 心聲, 角色/ゆみ. A set, not a list: the
   * order it arrives in carries nothing, and the stored form is sorted so two
   * units meaning the same thing look the same on disk.
   *
   * Any string is a legal tag. `project.tags` colours the ones it knows and
   * says nothing about the rest; a name it has never heard is still data the
   * user typed, and dropping it would be losing their work to a lookup miss.
   *
   * A facet — the `角色/` in `角色/ゆみ` — is a convention inside the string,
   * with nothing in the schema to hold it. How finely to cut the vocabulary is
   * a translation decision, and the file format has no business making it.
   *
   * On the unit rather than on any block: what a balloon means is one fact
   * about the balloon, not one fact per piece of lettering that could disagree.
   */
  tags: string[]

  source: TranslationUnitSide
  translation: TranslationUnitSide

  candidates: TranslationCandidate[]

  /**
   * Which of them this unit reads as, or null for what its blocks hold.
   *
   * ⭐ A pointer and not a copy: what was there before is still in the pool,
   * and the words somebody typed themselves are never overwritten by picking a
   * candidate.
   *
   * ⚠️ A candidate may only be pointed at while it has one block per
   * translation member. Whoever sets this is responsible for that being true.
   */
  chosen: string | null
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
   * Every translation on the page, each owning the blocks that say it.
   *
   * Held beside the tree rather than in it, like the two below: the tree
   * expresses z-order and containment, and a translation is neither. Blocks of
   * one translation are free to sit apart, in different folders, with other
   * layers between them.
   */
  translationUnits: TranslationUnit[]

  /**
   * Every translation on the page, in the order a reader meets them. Held
   * apart from the tree because the tree's own order is z-order, which is what
   * that tree exists to express.
   *
   * ⭐ Units and not blocks. Reading order answers which piece of content comes
   * first, and how many blocks a piece of lettering was split into is not an
   * answer to that.
   *
   * Whatever needs reading order reads this and never falls back to the tree.
   * A fallback is how an order someone set quietly reverts to stacking order.
   */
  readingOrder: string[]

  /**
   * The lines drawn between translations on this page, each saying that one is
   * read before another. A layer over the order rather than a replacement for
   * it: the order covers every unit because it is the typing surface, and a
   * line says the one thing a single column cannot, which is that two units
   * split off the same place.
   *
   * Empty is the ordinary state of a page and stays legal for ever — a short
   * chapter can be typeset without a single line being drawn. Concrete here
   * where the persisted form leaves it out when empty, so nothing downstream
   * has to keep asking whether an absent key means no lines.
   *
   * ⚠️ No line between two units does not mean they are read at the same
   * time. It means nobody has said. See `readingGraph.ts`.
   *
   * ⚠️ Both ends name a unit, which has no place on the page of its own. What
   * a line is drawn between has to be worked out from the blocks of whichever
   * side is being shown.
   */
  readingEdges: ReadingEdge[]

  layers: LayerEntry[]
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
