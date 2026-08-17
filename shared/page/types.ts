import type { TextStyle } from '../text-style/types'
import type { ReadingEdge } from './readingGraph'


export const MANIFEST_SCHEMA_VERSION = 10

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
 * A text object, whole — the manifest holds it rather than pointing at a copy
 * of it elsewhere, so creating or deleting one is a single atomic write and an
 * orphan cannot exist.
 *
 * It has no name. The tree and the label list are two views of these same
 * objects, and a name anyone could edit would let one object read differently
 * in each while drifting from the translation it stands for.
 */
export interface TextLayerEntry extends LayerEntryBase {
  kind: 'text'

  /**
   * Where the object stands on the page, in page pixels, and free to fall
   * between two of them.
   *
   * A raster layer's frame is whole pixels because its content *is* cells and
   * there is nothing else it could be. Typeset text is not: the pixels a reader
   * sees are a rasterization of outlines, so a whole number here would be a
   * property of that output written back onto the input, losing both the
   * precision and the fact that anything was lost.
   *
   * Which point of the object's frame this names is not stored: it follows from
   * the style's alignment, since a block with no frame of its own has nothing
   * between the edge its lines are aligned to and the edge of the block itself.
   */
  x: number

  y: number

  /**
   * What this object is, semantically — 框内, 心聲, 角色/ゆみ. A set, not a
   * list: the order it arrives in carries nothing, and the stored form is
   * sorted so two objects meaning the same thing look the same on disk.
   *
   * Any string is a legal tag. `project.tags` colours the ones it knows and
   * says nothing about the rest; a name it has never heard is still data the
   * user typed, and dropping it would be losing their work to a lookup miss.
   *
   * A facet — the `角色/` in `角色/ゆみ` — is a convention inside the string,
   * with nothing in the schema to hold it. How finely to cut the vocabulary is
   * a translation decision, and the file format has no business making it.
   */
  tags: string[]

  /**
   * The object's own turn on the page, in radians, clockwise. Concrete here
   * where the persisted form leaves it out at zero, so nothing downstream has
   * to keep asking whether an absent turn means upright.
   */
  rotation: number

  /** One entry per line; an embedded newline is refused at parse. */
  lines: string[]

  /**
   * Which reading this object stands for, and who decided that.
   *
   * ⚠️ `by` is what keeps a rerun from overruling a person. An automatic pass
   * may only write where `by` is `auto`; where it is `human` the slot is
   * settled, including when it is settled on nothing.
   */
  source: TextSource

  /**
   * A source someone wrote out themselves, for when no reading says what the
   * artwork says. Never filled by anything automatic; empty is its ordinary
   * state and stays legal for ever.
   */
  ownSource: string

  /**
   * Held by the object rather than by the page: a translation is written for
   * one object, unlike a reading, which was found on the artwork before
   * anybody knew whose it was.
   */
  translations: TranslationCandidate[]

  /**
   * Which of them this object reads as, or null for the lines above.
   *
   * ⭐ A pointer and not a copy: what was there before is still in the pool,
   * and `lines` — what somebody typed themselves — is never overwritten by
   * picking a candidate.
   */
  translation: string | null

  /**
   * The whole style, held by value — no group to inherit from and no override
   * layered on top. Two objects that look alike are two objects that hold the
   * same seven fields, and nothing changes what one of them looks like except
   * writing to it.
   *
   * The cost is that making a hundred objects agree means writing to a hundred
   * objects. That is what the batch operations are for, and it is paid on
   * purpose: it buys back the case a shared style cannot express, where an
   * object needs to leave the group it belongs to without leaving what it means.
   */
  style: TextStyle
}


export type SourceHand = 'auto' | 'human'

export interface TextSource {
  /**
   * A reading in this page's `ocr.json`, `own` for the object's own written
   * source, or null for a slot standing empty.
   */
  hash: string | 'own' | null
  by: SourceHand
}

/**
 * One way this object could read, once translated.
 *
 * ⚠️ Only what a person wrote carries a mark. A model spends no tokens saying
 * who it is, and the rule that protects the work is stated the other way round:
 * a marked candidate may not be edited, only appended after.
 */
export interface TranslationCandidate {
  id: string
  lines: string[]
  human?: boolean
  /**
   * Who proposed this, for telling drawers apart — the MCP handshake's
   * clientInfo, stamped by the server, costing the model nothing. Display
   * only: the mark that protects work is `human`, never this.
   */
  source?: string
}

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
   * Every text object on the page, in the order a reader meets them. Held
   * apart from the tree because the tree's own order is z-order, which is what
   * that tree exists to express.
   *
   * Whatever needs reading order reads this and never falls back to the tree.
   * A fallback is how an order someone set quietly reverts to stacking order.
   */
  readingOrder: string[]

  /**
   * The lines drawn between text objects on this page, each saying that one is
   * read before another. A layer over the order rather than a replacement for
   * it: the order covers every object because it is the typing surface, and a
   * line says the one thing a single column cannot, which is that two objects
   * split off the same place.
   *
   * Empty is the ordinary state of a page and stays legal for ever — a short
   * chapter can be typeset without a single line being drawn. Concrete here
   * where the persisted form leaves it out when empty, so nothing downstream
   * has to keep asking whether an absent key means no lines.
   *
   * ⚠️ No line between two objects does not mean they are read at the same
   * time. It means nobody has said. See `readingGraph.ts`.
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

  /** What it says now, which anyone may correct. */
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
}

export interface OcrJson {
  schemaVersion: typeof OCR_SCHEMA_VERSION

  width: number
  height: number
  candidates: OcrCandidatePersisted[]
}
