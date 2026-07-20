import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShashokuDoc } from '@/engine/document'
import {
  _resetAutosaveForTest,
  flushPendingRasterSave,
  scheduleRasterAutosave,
} from './autosave'

// mock window.api.writePage
const writePageMock = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  vi.useFakeTimers()
  writePageMock.mockClear()
  ;(globalThis as unknown as { window: { api: { writePage: typeof writePageMock } } }).window = {
    api: { writePage: writePageMock },
  }
  _resetAutosaveForTest()
})
afterEach(() => {
  vi.useRealTimers()
  _resetAutosaveForTest()
})

function makeDoc(): ShashokuDoc {
  return new ShashokuDoc(4, 4)
}

describe('scheduleRasterAutosave debounce', () => {
  it('單次 schedule → 800ms 後觸發一次 writePage', async () => {
    scheduleRasterAutosave('/proj/pages/01', makeDoc())
    expect(writePageMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(800)
    expect(writePageMock).toHaveBeenCalledTimes(1)
  })

  it('連續 schedule 在 800ms 內只觸發一次(重置 quiet timer)', async () => {
    scheduleRasterAutosave('/proj/pages/01', makeDoc())
    await vi.advanceTimersByTimeAsync(500)
    scheduleRasterAutosave('/proj/pages/01', makeDoc())
    await vi.advanceTimersByTimeAsync(500)
    // 累積 1000ms 但 quiet 只走了 500ms
    expect(writePageMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(300)
    expect(writePageMock).toHaveBeenCalledTimes(1)
  })

  it('連續 schedule 超過 maxWait(5000ms)強制落地一次', async () => {
    // 每 400ms schedule 一次持續 6 秒:quiet 永遠 reset,但 maxWait 到 5s 強制觸發
    scheduleRasterAutosave('/proj/pages/01', makeDoc())
    for (let elapsed = 0; elapsed < 6000; elapsed += 400) {
      await vi.advanceTimersByTimeAsync(400)
      if (writePageMock.mock.calls.length === 0) {
        scheduleRasterAutosave('/proj/pages/01', makeDoc())
      }
    }
    expect(writePageMock).toHaveBeenCalledTimes(1)
  })
})

describe('flushPendingRasterSave', () => {
  it('立即觸發 writePage 並清掉 pending', async () => {
    scheduleRasterAutosave('/proj/pages/01', makeDoc())
    await flushPendingRasterSave()
    expect(writePageMock).toHaveBeenCalledTimes(1)
    // 之後 timer 到期不應再觸發
    await vi.advanceTimersByTimeAsync(1000)
    expect(writePageMock).toHaveBeenCalledTimes(1)
  })

  it('無 pending 時 flush = noop', async () => {
    await flushPendingRasterSave()
    expect(writePageMock).not.toHaveBeenCalled()
  })

  it('flush 併發呼叫:共享同一個 inflight promise', async () => {
    scheduleRasterAutosave('/proj/pages/01', makeDoc())
    const p1 = flushPendingRasterSave()
    const p2 = flushPendingRasterSave()
    await Promise.all([p1, p2])
    expect(writePageMock).toHaveBeenCalledTimes(1)
  })
})

describe('跨頁 schedule', () => {
  it('多頁同時在 pending:debounce 到期後依序消到空', async () => {
    scheduleRasterAutosave('/proj/pages/01', makeDoc())
    scheduleRasterAutosave('/proj/pages/02', makeDoc())
    // 兩頁都在 pending Map,共用一個 debounce timer
    await vi.advanceTimersByTimeAsync(800)
    // performSave 內部 loop 消到空
    expect(writePageMock).toHaveBeenCalledTimes(2)
    const dirs = writePageMock.mock.calls.map((c) => c[0])
    expect(dirs).toContain('/proj/pages/01')
    expect(dirs).toContain('/proj/pages/02')
  })

  it('A→B→C 三頁連續切換(finding 10):三頁都會落地,無一遺失', async () => {
    scheduleRasterAutosave('/proj/pages/A', makeDoc())
    // A 的 debounce 到期,開始寫入(inflight)
    await vi.advanceTimersByTimeAsync(800)
    // 在 A 的 IPC 尚在飛時(fake timer 下 mock 立即 resolve,但邏輯上 inflight 有值)
    // schedule B、C — 兩者進 pending Map
    scheduleRasterAutosave('/proj/pages/B', makeDoc())
    scheduleRasterAutosave('/proj/pages/C', makeDoc())
    // 觸發 debounce 消耗 pending
    await vi.advanceTimersByTimeAsync(800)
    // A/B/C 三頁都應該被寫過
    const dirs = new Set(writePageMock.mock.calls.map((c) => c[0]))
    expect(dirs.has('/proj/pages/A')).toBe(true)
    expect(dirs.has('/proj/pages/B')).toBe(true)
    expect(dirs.has('/proj/pages/C')).toBe(true)
    expect(writePageMock).toHaveBeenCalledTimes(3)
  })

  it('flush 會消到 pending 全空(不論頁數)', async () => {
    scheduleRasterAutosave('/proj/pages/A', makeDoc())
    scheduleRasterAutosave('/proj/pages/B', makeDoc())
    scheduleRasterAutosave('/proj/pages/C', makeDoc())
    await flushPendingRasterSave()
    expect(writePageMock).toHaveBeenCalledTimes(3)
  })
})

describe('flush 與 timer 交互(finding 2/3 迴歸)', () => {
  it('timer 觸發 performSave 進入 inflight 後,flush 呼叫仍等到落地完成', async () => {
    const pending: { resolve?: () => void } = {}
    writePageMock.mockImplementationOnce(
      () => new Promise<void>((res) => (pending.resolve = res)),
    )
    scheduleRasterAutosave('/proj/pages/01', makeDoc())
    // debounce 到期,performSave 開始,inflight 有值,但 writePage 尚未 resolve
    await vi.advanceTimersByTimeAsync(800)
    expect(writePageMock).toHaveBeenCalledTimes(1)

    // 使用者按關閉:呼叫 flush,應該等待 inflight 完成
    let flushDone = false
    const flushP = flushPendingRasterSave().then(() => {
      flushDone = true
    })
    // 讓所有 microtask 跑一遍;flush 應該還在等 inflight
    await vi.advanceTimersByTimeAsync(0)
    expect(flushDone).toBe(false)

    // 現在解決 writePage
    pending.resolve?.()
    await flushP
    expect(flushDone).toBe(true)
  })
})

describe('writePage payload shape', () => {
  it('傳 manifestRaw + layerParts(不含 translation)', async () => {
    const doc = makeDoc()
    doc.addBlankLayer('底圖')
    scheduleRasterAutosave('/proj/pages/01', doc)
    await vi.advanceTimersByTimeAsync(800)
    expect(writePageMock).toHaveBeenCalledTimes(1)
    const [pageDir, input] = writePageMock.mock.calls[0]
    expect(pageDir).toBe('/proj/pages/01')
    expect(input.manifestRaw).toContain('"schemaVersion"')
    expect(input.layerParts).toBeDefined()
    expect(Object.keys(input.layerParts).length).toBe(1)
    // 不含 translationRaw / ocrRaw
    expect(input.translationRaw).toBeUndefined()
    expect(input.ocrRaw).toBeUndefined()
  })
})

describe('生成式檔名(P0 transaction fix)', () => {
  it('layer PNG 檔名含 .rev<N>.png,manifest revision 遞增', async () => {
    const doc = makeDoc()
    const layer = doc.addBlankLayer('底圖')
    scheduleRasterAutosave('/proj/pages/01', doc)
    await vi.advanceTimersByTimeAsync(800)

    const [, input] = writePageMock.mock.calls[0]
    // readCurrentRevision fallback = 0(readPage mock 未定義,catch),新 rev = 1
    const filenames = Object.keys(input.layerParts)
    expect(filenames.length).toBe(1)
    expect(filenames[0]).toMatch(new RegExp(`^${layer.id}\\.rev1\\.png$`))
    // manifest 內 revision 也是 1
    const manifest = JSON.parse(input.manifestRaw)
    expect(manifest.revision).toBe(1)
    expect(manifest.layers[0].file).toBe(filenames[0])
  })
})
