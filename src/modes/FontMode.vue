<template>
  <div class="flex h-full w-full select-none text-sm">
    <!-- 左:sidebar(與其他 mode 同殼)——字體群組 + 匯入資料夾管理 -->
    <aside
      class="flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card p-2"
      style="width: var(--layout-sidebar-w)"
    >
      <div class="mb-1 px-1 text-xs font-semibold text-muted-foreground">字體群組</div>
      <button
        v-for="g in groupList"
        :key="g.id"
        class="flex items-center justify-between rounded px-2 py-1.5 text-left"
        :class="
          group === g.id
            ? 'bg-primary text-primary-foreground'
            : 'bg-accent text-accent-foreground hover:bg-secondary'
        "
        @click="group = g.id"
      >
        <span>{{ g.label }}</span>
        <span class="text-xs opacity-70">{{ g.count }}</span>
      </button>

      <div class="mt-3 mb-1 px-1 text-xs font-semibold text-muted-foreground">匯入資料夾</div>
      <div
        v-for="folder in fontFolders"
        :key="folder"
        class="group/folder flex items-center justify-between gap-1 rounded px-2 py-1 text-xs hover:bg-secondary/40"
        :title="folder"
      >
        <span class="truncate">{{ folderName(folder) }}</span>
        <button
          class="shrink-0 opacity-0 group-hover/folder:opacity-100 hover:text-destructive"
          title="移除此資料夾(不動檔案,只取消匯入)"
          @click="removeFontFolder(folder)"
        >
          ✕
        </button>
      </div>
      <button
        class="rounded border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-secondary/40"
        @click="addFontFolder"
      >
        + 匯入字體資料夾
      </button>
      <p v-if="fontsNeedRestart" class="rounded bg-secondary/60 px-2 py-1 text-[11px] text-amber-400">
        資料夾已變更——重啟 app 後字體才會生效(fontconfig 在啟動時載入)。
      </p>

      <p class="mt-2 px-1 text-[11px] text-muted-foreground">
        點任一列直接改樣本文字,所有字體同步預覽。
      </p>
      <ModeSwitcher class="mt-auto" />
    </aside>

    <!-- 右:頂部工具列(搜索 + 字級)+ 字體預覽鋪滿 -->
    <main class="flex min-w-0 flex-1 flex-col bg-background">
      <div
        class="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
      >
        <input
          v-model="search"
          type="search"
          spellcheck="false"
          placeholder="搜索字體名稱…"
          class="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary"
        />
        <span class="shrink-0">字級</span>
        <input
          v-model.number="fontSize"
          type="range"
          min="14"
          max="64"
          step="1"
          class="w-48 shrink-0 accent-[var(--primary)]"
        />
        <span class="w-10 shrink-0 text-right tabular-nums">{{ fontSize }}px</span>
      </div>

      <!-- 樣本文字預設集:點一顆全體切換;任一格手改文字仍全域同步 -->
      <div
        class="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-1 text-xs"
      >
        <button
          v-for="p in SAMPLE_PRESETS"
          :key="p.label"
          class="shrink-0 rounded px-2 py-0.5"
          :class="
            sample === p.text
              ? 'bg-primary text-primary-foreground'
              : 'bg-accent text-accent-foreground hover:bg-secondary'
          "
          :title="p.text"
          @click="sample = p.text"
        >
          {{ p.label }}
        </button>
        <span class="min-w-0 truncate pl-1 text-muted-foreground/60">{{ sample }}</span>
      </div>

      <div ref="scrollEl" class="min-h-0 flex-1 overflow-y-auto">
        <p v-if="error" class="p-4 text-destructive">字體枚舉失敗:{{ error }}</p>
        <p v-else-if="!displayed.length" class="p-4 text-muted-foreground">
          {{
            appliedSearch.trim()
              ? `沒有符合「${appliedSearch.trim()}」的字體。`
              : group === 'fav'
                ? '尚無最愛——點字體右上角的星號加入。'
                : group === 'imported'
                  ? '尚未匯入——左側「+ 匯入字體資料夾」選一個裝滿字體檔的資料夾。'
                  : '載入中…'
          }}
        </p>
        <!-- spacer 撐出總高,虛擬列絕對定位 translateY 到各自 start。
             每個家族一個 input,共用同一份樣本文字。行高不鎖:line-height
             交給各字體自己的 metrics,高的字體列自然變高(量測回正) -->
        <div
          v-else
          class="relative w-full"
          :style="{ height: `${totalSize}px`, '--preview-size': `${appliedSize}px` }"
        >
          <div
            v-for="vrow in virtualRows"
            :key="vrow.index"
            :ref="measureRow"
            :data-index="vrow.index"
            class="font-row absolute left-0 top-0 w-full"
            :style="{
              transform: `translateY(${vrow.start}px)`,
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            }"
          >
            <label v-for="f in rows[vrow.index]" :key="f" class="font-cell group/cell">
              <span class="flex items-center justify-between gap-2">
                <span class="flex min-w-0 items-center gap-1.5">
                  <span class="truncate text-[11px] text-muted-foreground">{{ f }}</span>
                  <span
                    v-if="importedSet.has(f)"
                    class="shrink-0 rounded-sm bg-secondary px-1 text-[10px] text-muted-foreground"
                    >匯入</span
                  >
                </span>
                <button
                  class="shrink-0 text-sm leading-none"
                  :class="
                    favSet.has(f)
                      ? 'text-amber-400'
                      : 'text-muted-foreground/40 opacity-0 group-hover/cell:opacity-100 hover:text-amber-400'
                  "
                  :title="favSet.has(f) ? '移出最愛' : '加入最愛'"
                  @click.prevent.stop="toggleFav(f)"
                >
                  {{ favSet.has(f) ? '★' : '☆' }}
                </button>
              </span>
              <!-- 快速捲動中不掛真字體,改渲染明確的佔位文字——若用預設
                   字體渲染樣本,使用者無法分辨「這是該字體長相還是還沒
                   渲染好」;佔位文字消除歧義 -->
              <span
                v-if="fastScroll && !loadedFamilies.has(f)"
                class="cell-loading text-muted-foreground/40"
                >正在加載……</span
              >
              <!-- textarea 而非 input:對白氣泡本來就是多行的——長樣本
                   在窄格自動換行、Enter 手動斷行;field-sizing-content
                   讓高度跟內容走,列高交給虛擬列表量測回正 -->
              <textarea
                v-else
                v-model="sample"
                rows="1"
                spellcheck="false"
                class="w-full field-sizing-content resize-none bg-transparent outline-none placeholder:text-muted-foreground/40"
                :style="{ fontFamily: `'${f.replaceAll(`'`, '')}'` }"
                placeholder="輸入樣本文字…"
              ></textarea>
            </label>
          </div>
        </div>
      </div>

    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { refDebounced, useElementSize, useEventListener, useLocalStorage } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import ModeSwitcher from '@/components/ModeSwitcher.vue'
import { appMode } from '@/lib/appMode'
import {
  addFontFolder,
  fontFolders,
  fontsNeedRestart,
  importedFamilies,
  removeFontFolder,
} from '@/lib/importedFonts'

type Group = 'all' | 'fav' | 'imported'
const group = ref<Group>('all')

/** 樣本文字預設集:服務對象是漫畫嵌字者,預設用口語高頻詞 + 漫畫
 * 標點(刪節號/!?/長音)看「對白排出來像不像樣」;檢字串(筆法展示
 * 「永」、繁簡分歧「體」、高密度「鬱」、假名、Ag)降級為其中一顆按鈕 */
const SAMPLE_PRESETS = [
  // 對白與檢字都用「繁簡同文對照」:同句繁一行簡一行,缺字形的那行
  // 會 fallback 成別的字體,繁簡覆蓋一眼可見
  { label: '對白', text: '等一下……你是說真的嗎!?\n等一下……你是说真的吗!?' },
  { label: '喊叫', text: '哇啊啊啊——不要過來啊!!' },
  { label: '日文', text: 'わかっているのか? 撃っていいのは、撃たれる覚悟のある奴だけだ!' },
  {
    label: '檢字',
    text: '永字八法 體鬱龍書\n哎呀啊喔 体郁龙书\nあアぐグ Ag123 0O1Il',
  },
] as const

/** 所有樣本框共用的文字:v-model 綁同一個 ref = 天然全體同步 */
const sample = ref<string>(SAMPLE_PRESETS[0].text)

/** 預覽字級;格子最小寬按字級等比縮放(40px ≈ 520px 起跳)。
 * 套用值走 debounce:拖動中只動數字顯示,停手 150ms 才重排——虛擬化後
 * 一次重排只碰視口內幾列,但大字體 shaping 仍不便宜,連發還是浪費 */
const fontSize = ref(40)
const appliedSize = refDebounced(fontSize, 150)
const appliedMinW = computed(() => Math.round(appliedSize.value * 13))

/** 最愛清單:app 級偏好,localStorage 常駐(重啟不丟) */
const favs = useLocalStorage<string[]>('shashoku:font-favs', [])
const favSet = computed(() => new Set(favs.value))
function toggleFav(family: string) {
  favs.value = favSet.value.has(family)
    ? favs.value.filter((f) => f !== family)
    : [...favs.value, family]
}

/** 系統字體(queryLocalFonts)家族 */
const systemFamilies = ref<string[]>([])
const error = ref<string | null>(null)

const importedSet = computed(() => new Set(importedFamilies.value))
/** 系統 + 匯入合併(同名家族只列一次) */
const allFamilies = computed(() =>
  [...new Set([...systemFamilies.value, ...importedSet.value])].sort((a, b) =>
    a.localeCompare(b, 'zh-Hant'),
  ),
)
/** 名稱搜索:不分大小寫 substring。過濾值走 debounce——每鍵入一字就
 * 換一批清單,視口瞬間全是沒加載過的字體,連環 mount 會卡打字 */
const search = ref('')
const appliedSearch = refDebounced(search, 200)

const displayed = computed(() => {
  let list = allFamilies.value
  if (group.value === 'fav') list = list.filter((f) => favSet.value.has(f))
  else if (group.value === 'imported') list = list.filter((f) => importedSet.value.has(f))
  const q = appliedSearch.value.trim().toLowerCase()
  return q ? list.filter((f) => f.toLowerCase().includes(q)) : list
})

// ── 列虛擬化(@tanstack/vue-virtual)──
// 每格都逼 Chromium 做一次不快取的 FcFontSort 配對 + 讀進 10-30MB 字體檔,
// 1000+ 家族全量進 DOM 是災難(即使 content-visibility 也躲不掉全列表
// style recalc)。改成:容器寬算欄數 → 家族切成列 → 只掛視口內的列,
// 改字級時要重排的永遠只有那幾列。
// 行高不鎖(交給各字體 metrics),所以走 estimateSize 粗估 + measureElement
// 實測回正的動態量測,列高由內容自己決定。
const scrollEl = ref<HTMLElement | null>(null)
const { width: gridWidth } = useElementSize(scrollEl)
const cols = computed(() => Math.max(1, Math.floor(gridWidth.value / appliedMinW.value)))
const rows = computed(() => {
  const c = cols.value
  const out: string[][] = []
  for (let i = 0; i < displayed.value.length; i += c) out.push(displayed.value.slice(i, i + c))
  return out
})

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollEl.value,
    // 粗估一列:格 padding 20 + 名稱列 16 + gap 4 + 樣本行(字級 × 1.5)
    estimateSize: () => Math.round(appliedSize.value * 1.5 + 40),
    // 前後各預加載 6 列:閒置時就把即將進場的字體先開檔渲染好,短距離
    // 快速捲動落在預加載帶內,連佔位文字都不會出現
    overscan: 6,
  })),
)
const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

/** measureElement 靠 data-index 對回列;unmount 時 Vue 會用 null 呼叫 ref */
function measureRow(el: unknown) {
  if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
}

// 字級/欄數/清單一變,已量測列高全部失真——清掉,退回 estimateSize 重測
watch([appliedSize, cols, displayed], () => virtualizer.value.measure())

// ── 快速捲動偵測:限制一次加載的字體檔數 ──
// scrollbar 拖曳/長距離 fling 時每個 scroll 事件跳過整個視口,新進場的
// 每個家族都是首次使用 = 開檔 mmap 10-30MB + shaping,一幀塞幾十個直接
// 凍住主執行緒秒級(scrollbar 跟著卡死)。rAF 節流量測每幀位移,超過
// 門檻就先渲染佔位文字(免字體加載),停手 150ms 才套真字體——真正
// 付出加載成本的只有最終停留的那個視口。
const fastScroll = ref(false)
/** 每幀位移門檻:scrollbar 拖曳輕鬆破千,滾輪逐行捲約 100px 上下不觸發 */
const FAST_PX_PER_FRAME = 360
let prevTop = 0
let scrollRaf = 0
let settleTimer = 0
useEventListener(
  scrollEl,
  'scroll',
  () => {
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      const el = scrollEl.value
      if (!el) return
      const top = el.scrollTop
      if (Math.abs(top - prevTop) > FAST_PX_PER_FRAME) fastScroll.value = true
      prevTop = top
      window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        fastScroll.value = false
      }, 150)
    })
  },
  { passive: true },
)

/** 已用真字體渲染過的家族:字體檔已在 Chromium 快取,重繪近乎免費。
 * fastScroll 時這些照常渲染,佔位只給真正沒加載過的家族——不然一觸發
 * 就整屏(含早已渲染好的區域)閃成「正在加載」。非 reactive 就夠:只在
 * fastScroll 觸發的重繪裡被讀,而 post-flush watcher 在那之前已寫入 */
const loadedFamilies = new Set<string>()
watch(
  [virtualRows, fastScroll],
  () => {
    if (fastScroll.value) return
    for (const vrow of virtualRows.value)
      for (const f of rows.value[vrow.index] ?? []) loadedFamilies.add(f)
  },
  { flush: 'post' },
)

const groupList = computed(() => [
  { id: 'all' as Group, label: 'All', count: allFamilies.value.length },
  { id: 'fav' as Group, label: 'Fav', count: favs.value.length },
  { id: 'imported' as Group, label: '已匯入', count: importedFamilies.value.length },
])

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

// 惰性枚舉:首次切進字體視圖才呼叫(v-show 常駐,App 啟動時就 mount,
// 不該讓沒用到的視圖在啟動路徑上掃 1000+ 字體)
let loaded = false
watch(
  appMode,
  async (m) => {
    if (m !== 'fonts' || loaded) return
    loaded = true
    try {
      const faces = await queryLocalFonts()
      // face(含 Bold/Italic 變體)按 family 收斂,一個家族一列
      systemFamilies.value = [...new Set(faces.map((f) => f.family))]
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      loaded = false // 允許下次進入重試
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.font-row {
  display: grid;
  /* 進場淡入:捲動時新列 mount 是整格瞬間彈出,大字體 shaping 又讓它
     晚半拍,視覺上像卡頓。淡入把「彈出」變「浮現」。列靠 v-for
     :key=index 復用,同 index 重繪不會重播動畫,只有新 mount 的列才淡入 */
  animation: row-in 150ms ease-in;
}
@keyframes row-in {
  from {
    opacity: 0;
  }
}
.font-cell {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.625rem 0.75rem;
  background: var(--background);
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.font-cell textarea,
.font-cell .cell-loading {
  line-height: normal;
  font-size: var(--preview-size, 40px);
}
.font-cell textarea {
  /* textarea 是 overflow 裁切容器,高度按字體自報 metrics 算——老字體
     常謊報 descent(字形畫得比宣告深),g/y 尾巴會被裁。上下留墨跡
     餘量(em 隨字級縮放),裁切邊界退到 padding 外 */
  padding-block: 0.1em 0.3em;
}
.font-cell:focus-within {
  background: var(--card);
}
</style>
