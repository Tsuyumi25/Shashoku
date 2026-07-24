







import type { SskLabel } from '../ssk/types'


export const MANIFEST_SCHEMA_VERSION = 2

export const TRANSLATION_SCHEMA_VERSION = 2
export const OCR_SCHEMA_VERSION = 1


interface LayerEntryBase {
  
  id: string
  name: string
  visible: boolean
  locked: boolean
}


export interface RasterLayerEntry extends LayerEntryBase {
  kind: 'raster'
  
  file: string
  
  opacity: number
  
  blendMode: string
  alphaLocked: boolean
}


export interface TextLayerEntry extends LayerEntryBase {
  kind: 'text'
  labelId: string
}


export interface GroupLayerEntry extends LayerEntryBase {
  kind: 'group'
  children: LayerEntry[]
  styleBinding?: { labelGroupId: string }
}

export type LayerEntry = RasterLayerEntry | TextLayerEntry | GroupLayerEntry


export interface ManifestJson {
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  
  revision: number
  
  layers: LayerEntry[]
}


export interface TranslationJson {
  schemaVersion: typeof TRANSLATION_SCHEMA_VERSION
  labels: SskLabel[]
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
