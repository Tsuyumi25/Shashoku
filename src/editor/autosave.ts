// Raster autosave:塗抹結束後 debounced 落地 pages/<n>/layers/*.png + manifest.json。
//
// 責任分工(見 plan 檔):
// - label / group 等 UI 資料的 dirty:走 projectStore + Ctrl+S
// - raster 塗抹(pixel changes):走這裡,每次 pointerup 後排程,不用手動存
//
// 落地順序遵守「manifest 最後寫」pattern:writePage handler 已保證。
//
// Debounce 策略:每次 mark 重置 quiet timer(800ms);另有 maxWait(5000ms)
// 上限——連續繪畫超過 5 秒也強制落地一次,避免長 session 累積過多未存量。
//
// 併發模型:
// - pending 是 Map<pageDir, doc>:同頁重複 mark 覆寫 doc(下次 flush 拿最新);
//   跨頁 mark 各自留條目,不會像單一 slot 那樣被後者覆蓋(A→B→C 三頁連續切換
//   仍能保證每頁最終落地)。
// - 同時只有一個 IPC 寫入在飛(inflight),完成後若 pending 還有東西就繼續消,
//   直到 pending 空為止。
// - flushPendingRasterSave 語意:「處理完當下 inflight + pending 內所有頁」

import { parseManifest, serializeManifest } from '@shared/page/schema'
import { MANIFEST_SCHEMA_VERSION, type LayerEntry, type ManifestJson } from '@shared/page/types'
import type { ShashokuDoc } from '@/engine/document'
import type { Layer } from '@/engine/layer-tree'

const DEBOUNCE_MS = 800
const MAX_WAIT_MS = 5000

/** key = pageDir, value = 該頁最新的 doc 引用。同頁覆寫;跨頁並存。 */
const pending = new Map<string, ShashokuDoc>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null
/** 一個進行中的 flush promise;有值代表目前正在飛一個 IPC 寫入。 */
let inflight: Promise<void> | null = null

function clearTimers(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (maxWaitTimer !== null) {
    clearTimeout(maxWaitTimer)
    maxWaitTimer = null
  }
}

/**
 * doc 的當前 layers 序列化成 manifest + 每層獨立 PNG bytes。
 *
 * 生成式檔名(generation-based storage):新 rev 用 `<layer-id>.rev<N>.png`,
 * 舊 rev 檔仍在磁碟上不被覆寫。這保證 crash 於「寫 layers 中間、manifest
 * 未更新」時,舊 manifest 指向的舊 rev PNG 完全沒動,是**真正的完整 snapshot**,
 * 不是「舊 metadata + 新舊混合的檔案」。清理由 openProject 的 GC 負責。
 *
 * C1 現況:doc.layers 已升 Layer[] 樹型別,但 root 只有 raster leaf——
 * 遞迴 walk 是為 C2 之後 text / group 節點進 tree 做準備。text / group
 * 節點只寫 metadata 進 manifest,不落地 PNG(text 的內容在 translation.json
 * 的 label SSOT,group 是純 z-order 容器)。
 */
async function snapshotDoc(
  doc: ShashokuDoc,
  revision: number,
): Promise<{
  manifest: ManifestJson
  layerParts: Record<string, Uint8Array>
}> {
  const layerParts: Record<string, Uint8Array> = {}

  async function walk(nodes: readonly Layer[]): Promise<LayerEntry[]> {
    const out: LayerEntry[] = []
    for (const layer of nodes) {
      if (layer.kind === 'raster') {
        // 檔名帶 revision:舊 rev 保留,crash 復原用
        const file = `${layer.id}.rev${revision}.png`
        layerParts[file] = await doc.exportLayerPng(layer.id)
        out.push({
          kind: 'raster',
          id: layer.id,
          file,
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          blendMode: layer.blendMode,
          locked: layer.locked,
          alphaLocked: layer.alphaLocked,
        })
      } else if (layer.kind === 'text') {
        out.push({
          kind: 'text',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
          labelId: layer.labelId,
        })
      } else {
        const children = await walk(layer.children)
        const entry: LayerEntry = {
          kind: 'group',
          id: layer.id,
          name: layer.name,
          visible: layer.visible,
          locked: layer.locked,
          children,
        }
        if (layer.styleBinding !== undefined)
          entry.styleBinding = { labelGroupId: layer.styleBinding.labelGroupId }
        out.push(entry)
      }
    }
    return out
  }

  const entries = await walk(doc.layers)
  return {
    manifest: { schemaVersion: MANIFEST_SCHEMA_VERSION, revision, layers: entries },
    layerParts,
  }
}

/** 讀當前 pageDir 的 manifest 拿 revision;不存在或損毀視為 0。 */
async function readCurrentRevision(pageDir: string): Promise<number> {
  try {
    const raw = await window.api.readPage(pageDir)
    return parseManifest(raw.manifestRaw).revision
  } catch {
    return 0
  }
}

/** 從 pending Map 取一個條目寫入。同時只有一個 in-flight,靠 inflight 保證。 */
async function performSave(): Promise<void> {
  // 已有 IPC 在飛:等它完成後再嘗試(如果那時 pending 還有東西會繼續消)
  if (inflight) {
    await inflight
    if (pending.size > 0) await performSave()
    return
  }
  if (pending.size === 0) return

  // 取一個 entry 處理;之後仍有剩就再走一輪
  const [pageDir, doc] = pending.entries().next().value as [string, ShashokuDoc]
  pending.delete(pageDir)
  // pending 清空後 timer 就沒意義了,新的 mark 進來會重新設
  if (pending.size === 0) clearTimers()

  const promise = (async () => {
    try {
      // 拿現有 manifest 的 revision,新版 = +1
      const prevRev = await readCurrentRevision(pageDir)
      const { manifest, layerParts } = await snapshotDoc(doc, prevRev + 1)
      await window.api.writePage(pageDir, {
        manifestRaw: serializeManifest(manifest),
        layerParts,
      })
    } finally {
      inflight = null
    }
  })()
  inflight = promise
  await promise
  // 完成後如果又有新的 pending 進來(timer 或 caller),繼續消
  if (pending.size > 0) await performSave()
}

/**
 * 排程 raster 落地。呼叫方:LetterMode 的 onPointerUp / 相關筆刷結束處。
 * 同一頁重複 mark 會重置 quiet timer;跨頁 mark 各自進 pending 佇列。
 */
export function scheduleRasterAutosave(pageDir: string, doc: ShashokuDoc): void {
  pending.set(pageDir, doc)
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void performSave()
  }, DEBOUNCE_MS)
  // maxWait 只在第一次 mark 時起,不隨後續 mark 重置
  if (maxWaitTimer === null) {
    maxWaitTimer = setTimeout(() => {
      void performSave()
    }, MAX_WAIT_MS)
  }
}

/**
 * 立即落地目前 pending 的 raster(若有)。呼叫方:換頁前、App.vue ensureSaved、
 * 應用退出前。呼叫者 await 這個以確保「所有進行中的塗抹都在下一步之前落盤」。
 *
 * 語意:等到「當下的 inflight 與 pending 都處理完」為止。若期間又有新 mark
 * 進來,那是新的動作,不屬於本次 flush 保證(但 performSave 內部會繼續消)。
 */
export async function flushPendingRasterSave(): Promise<void> {
  // 依賴 performSave 內部的「消到空」loop
  if (inflight || pending.size > 0) await performSave()
}

/** test-only:重置模組狀態,避免 test 間互相污染。 */
export function _resetAutosaveForTest(): void {
  pending.clear()
  clearTimers()
  inflight = null
}
