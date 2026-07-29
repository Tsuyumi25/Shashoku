import type { TextStyle } from '../text-style/types'


export const MANIFEST_SCHEMA_VERSION = 3

export const OCR_SCHEMA_VERSION = 1


interface LayerEntryBase {

  id: string
  visible: boolean
  locked: boolean
}


export interface RasterLayerEntry extends LayerEntryBase {
  kind: 'raster'
  name: string

  file: string

  opacity: number

  blendMode: string
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

  x: number

  y: number

  groupId: string | null

  /**
   * The object's own turn on the page, in radians, clockwise. Concrete here
   * where the persisted form leaves it out at zero, so nothing downstream has
   * to keep asking whether an absent turn means upright.
   */
  rotation: number

  /** One entry per line; an embedded newline is refused at parse. */
  lines: string[]

  styleOverride?: Partial<TextStyle>
}


/** A folder, and only that: no style of its own, no meaning to the translation. */
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
