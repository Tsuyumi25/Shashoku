/** 預設分組(沿襲原版 LabelPlus 慣例,老用戶零學習成本) */
export const DEFAULT_GROUPS = ['框内', '框外']

/** category 1~9 的顯示顏色,index = category - 1 */
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

export const MAX_GROUPS = 9

/**
 * PS 腳本端的保留名:_Label 是標號圖層的 LayerSet 名,
 * _start/_end 是 action 鉤子名。分組不得撞名。
 */
export const RESERVED_GROUP_NAMES = ['_Label', '_start', '_end']

/** 開資料夾時列入清單的圖片副檔名(小寫比對) */
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp']

/** 工程檔的複合副檔名。判斷一律用 endsWith(path.extname 只認最後一段) */
export const SSK_FILE_SUFFIX = '.ssk.json'

// ── 新架構(v1)專案結構常數:root/ 底下的 shashoku/ 資料夾與其內部布局 ──

/** root 底下的專案資料夾名 */
export const SHASHOKU_DIR = 'shashoku'

/** shashoku/ 內的 sentinel marker,存在即代表是 Shashoku 專案根;開檔時偵測雲端截斷 */
export const SENTINEL_FILENAME = '.shashoku-project'

/** shashoku/ 內的專案 metadata 檔(groups + comment + glossary + exportConfig) */
export const PROJECT_JSON_FILENAME = 'project.json'

/** pristine 原圖副本資料夾;raws/xxx.png ↔ pages/xxx/ 靠檔名對應 */
export const DIR_RAWS = 'raws'
/** 每頁的資料夾容器;pages/<basename>/ */
export const DIR_PAGES = 'pages'
/** 每頁內的圖層 PNG 資料夾 */
export const DIR_LAYERS = 'layers'
/** 每頁內的可重生 cache(縮圖等);砍掉可重建 */
export const DIR_CACHE = 'cache'
/** 專案級 bundle 的字體檔案;預設空,export 時可選填 */
export const DIR_FONTS = 'fonts'

/** 每頁的 manifest,唯一 commit 錨點,永遠最後寫入 */
export const PAGE_MANIFEST_FILENAME = 'manifest.json'
/** 每頁的譯文 + label 標號 */
export const PAGE_TRANSLATION_FILENAME = 'translation.json'
/** 每頁的 OCR 結果,選用 */
export const PAGE_OCR_FILENAME = 'ocr.json'
