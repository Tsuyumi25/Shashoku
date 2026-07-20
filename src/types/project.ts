// UI 執行期的內部模型。和工程檔格式(shared/ssk/types)的差異:
// - 譯文用單一 string(textarea 原生行為),序列化邊界才轉 lines[]
// - missing 是對帳的執行期產物,不進檔案
export interface LabelItem {
  /** 前端追蹤用 UUID,寫入工程檔的 id 欄位 */
  id: string
  /** X 座標,相對原圖寬度的百分比 ∈ [0,1] */
  x: number
  /** Y 座標,相對原圖高度的百分比 ∈ [0,1] */
  y: number
  /** 分組編號 1~9,對應 header.groups 的 index+1 */
  category: number
  text: string
}

export interface ProjectFile {
  filename: string
  labels: LabelItem[]
  /** 新架構下,pages/<stem>/ 的絕對路徑;save/load per-page 都靠它 */
  pageDir: string
  /** raws ↔ pages 對帳狀態,可見化雲端同步斷裂與手動變更 */
  badge: 'ok' | 'raw-missing' | 'page-missing'
}

export interface ProjectHeader {
  /** index 0 = category 1,上限 9 個 */
  groups: string[]
  comment: string
}
