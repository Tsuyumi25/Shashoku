
export const DEFAULT_GROUPS = ['框内', '框外']


export const CATEGORY_COLORS = [
  'rgb(255, 0, 0)',
  'rgb(0, 0, 255)',
  'rgb(0, 128, 0)',
  'rgb(30, 144, 255)',
  'rgb(255, 215, 0)',
  'rgb(255, 0, 255)',
  'rgb(160, 82, 45)',
  'rgb(255, 69, 0)',
  'rgb(148, 0, 211)',
] as const


export const RESERVED_GROUP_NAMES = ['_Label', '_start', '_end']


export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp']




export const SHASHOKU_DIR = 'shashoku'


export const SENTINEL_FILENAME = '.shashoku-project'


export const PROJECT_JSON_FILENAME = 'project.json'


export const DIR_RAWS = 'raws'

export const DIR_PAGES = 'pages'

export const DIR_LAYERS = 'layers'

export const DIR_CACHE = 'cache'

export const DIR_FONTS = 'fonts'


/** Where a page's raster layers sit, beside its manifest. */
export function layersDirOf(pageDir: string): string {
  return `${pageDir}/${DIR_LAYERS}`
}


export const PAGE_MANIFEST_FILENAME = 'manifest.json'

export const PAGE_OCR_FILENAME = 'ocr.json'
