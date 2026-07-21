// UI 執行期的內部模型。和工程檔格式(shared/ssk/types)的差異:
// - 譯文用單一 string(textarea 原生行為),序列化邊界才轉 lines[]
// - missing 是對帳的執行期產物,不進檔案
import type { TextStyle } from '@shared/text-style/types'
import type { StyleGroup } from '@shared/project/types'

export interface LabelItem {
  /** 前端追蹤用 UUID,寫入工程檔的 id 欄位 */
  id: string
  /** X 座標,相對原圖寬度的百分比 ∈ [0,1] */
  x: number
  /** Y 座標,相對原圖高度的百分比 ∈ [0,1] */
  y: number
  /** 樣式群組綁定;對應 ProjectHeader.groups[].id;null = 未綁(走 defaultStyle) */
  groupId: string | null
  text: string
  /** 個別樣式覆寫(diff 存法);詳見 shared/ssk/types.ts SskLabel.styleOverride */
  styleOverride?: Partial<TextStyle>
}

export interface ProjectFile {
  filename: string
  labels: LabelItem[]
  /** 新架構下,pages/<stem>/ 的絕對路徑;save/load per-page 都靠它 */
  pageDir: string
  /** raws ↔ pages 對帳狀態,可見化雲端同步斷裂與手動變更;damaged 禁 autosave */
  badge: 'ok' | 'raw-missing' | 'page-missing' | 'damaged'
}

export interface ProjectHeader {
  /** 樣式群組陣列(有序);無數量上限,用戶自定義 */
  groups: StyleGroup[]
  /** 樣式繼承鍊終極 fallback:label 無 groupId 且無 override 時使用 */
  defaultStyle: TextStyle
  comment: string
}
