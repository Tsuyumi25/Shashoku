// Import 的純函數邏輯:比對「root 現有圖」跟「shashoku/raws/ 內副本」,
// 產生 diff 清單供 UI 呈現使用者選擇。實際 IO 操作在 electron/lib/projectFs.ts。

export interface ImportDiff {
  /** root 有、raws 沒:候選匯入(UI 預設全選) */
  toAdd: string[]
  /** root 和 raws 都有:既有頁面(UI 顯示為 disabled/灰色) */
  existing: string[]
  /** raws 有、root 沒:孤兒副本(使用者已刪 root 原檔,不主動處理) */
  orphanRaws: string[]
}

/** filename-only 對照;不做 hash / mtime 比對(那是未來的批改工具的責任)。 */
export function previewImport(rootImages: string[], rawImages: string[]): ImportDiff {
  const rawsSet = new Set(rawImages)
  const rootSet = new Set(rootImages)

  const toAdd: string[] = []
  const existing: string[] = []
  for (const name of rootImages) {
    if (rawsSet.has(name)) existing.push(name)
    else toAdd.push(name)
  }

  const orphanRaws: string[] = []
  for (const name of rawImages) {
    if (!rootSet.has(name)) orphanRaws.push(name)
  }

  return { toAdd, existing, orphanRaws }
}
