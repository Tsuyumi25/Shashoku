import type { TextStyle } from '../text-style/types'


export const MANIFEST_SCHEMA_VERSION = 6

export const OCR_SCHEMA_VERSION = 1

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
   * The raw's own pixel size, once anything has decoded it. A position in page
   * pixels means nothing without the page it was measured against, and a raw
   * replaced by a scan at another resolution would otherwise put every layer
   * somewhere wrong with nothing able to notice.
   *
   * Absent is a state of its own — nobody has measured this page yet — rather
   * than a zero anyone could mistake for a measurement.
   */
  width?: number
  height?: number

  /**
   * Every text object on the page, in the order a reader meets them. Held
   * apart from the tree because the tree's own order is z-order, which is what
   * that tree exists to express.
   *
   * Whatever needs reading order reads this and never falls back to the tree.
   * A fallback is how an order someone set quietly reverts to stacking order.
   */
  readingOrder: string[]

  layers: LayerEntry[]
}



export type OcrBlockLabel = 'bubble' | 'text_bubble' | 'text_free'

export interface OcrBlockPersisted {
  x: number
  y: number
  w: number
  h: number
  label: OcrBlockLabel
  score: number
  text?: string
}

export interface OcrJson {
  schemaVersion: typeof OCR_SCHEMA_VERSION

  width: number
  height: number
  blocks: OcrBlockPersisted[]
}
