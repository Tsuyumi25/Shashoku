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
