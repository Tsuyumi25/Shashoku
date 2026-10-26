<template>
  <div class="flex h-full w-full flex-col">
    <div v-if="!project.isOpen" class="flex flex-1 items-center justify-center p-8">
      <p class="max-w-xs text-center text-sm text-muted-foreground">
        左邊的清單就是你的專案櫃。用「新增」把一個裝著原圖的資料夾建成專案,或用「加入資料夾」把已經做過的一批列進來。
      </p>
    </div>

    <div v-else-if="project.files.length === 0" class="flex flex-1 items-center justify-center p-8">
      <p class="max-w-xs text-center text-sm text-muted-foreground">
        還沒有頁面。左邊挑要用的圖,按「建立 N 頁」——那一步會把像素複製進專案,之後原圖搬走或刪掉都不影響。
      </p>
    </div>

    <!-- Dragging across the grid picks pages; it must never start highlighting page
         names instead. -->
    <div
      v-else
      ref="scroller"
      class="relative min-h-0 flex-1 overflow-y-auto p-2 select-none"
      @pointerdown="onPointerDown"
    >
      <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-2">
        <PageThumb
          v-for="file in project.files"
          :key="file.pageId"
          class="export-card"
          :data-key="file.pageId"
          :file="file"
          :selected="exportSelection.isSelected(file.pageId)"
        />
      </div>

      <div v-if="marqueeStyle" class="export-marquee" :style="marqueeStyle" />
      <div v-if="dropLineStyle" class="export-drop-line" :style="dropLineStyle" />
    </div>

    <!--
      Deleting sits at the far end, as far from picking as the bar is wide. They
      are the two halves of the same mistake — picking everything and then
      pressing the thing beside it.

      The count appears only where nothing else says it. Beside a delete button
      that already carries the number it would be the same figure twice.
    -->
    <div v-if="project.isOpen" class="bar">
      <button
        class="bar-button"
        :disabled="project.files.length === 0"
        @click="exportSelection.toggleAll()"
      >
        <span class="pick" :data-checked="String(exportSelection.allSelected)">
          <Check :size="11" :stroke-width="3" />
        </span>
        <span>全選</span>
      </button>

      <span class="bar-head">
        專案頁面
        <span class="bar-count">
          ({{ exportSelection.selectedPages.length }}/{{ project.files.length }})
        </span>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { Check } from '@lucide/vue'
import { reorderPages } from '@shared/project/pages'
import PageThumb from '@/components/PageThumb.vue'
import { loadFontCatalog } from '@/lib/fontCatalog'
import { marqueeRect } from '@/lib/selection/marquee'
import type { Point, Rect } from '@/lib/selection/rect'
import { insertionIndexAt } from '@/lib/selection/shelfDrop'
import {
  clientToContent,
  DRAG_THRESHOLD_PX,
  edgeDistance,
  edgeDistanceFactor,
  edgeScrollSpeed,
  edgeTimeFactor,
  resolveFrame,
  scrollEdgeFor,
  scrollZoneDepth,
  touchedKeys,
  type CardBox,
  type ScrollerFrame,
} from '@/lib/selection/shelfMarquee'
import { useEditorStore } from '@/stores/editorStore'
import { useExportStore } from '@/stores/exportStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'

const project = useProjectStore()
const preferences = usePreferencesStore()
const exportSelection = useExportStore()
const editor = useEditorStore()

// Nothing composites without the catalogue, and this view can be the first one
// a session ever reaches.
onMounted(() => {
  loadFontCatalog(preferences.prefs.fontFolders).catch((err: unknown) => {
    console.error('font enumeration failed', err)
  })
})

interface PendingCard {
  kind: 'card'
  pointerId: number
  pageId: string
  start: Point
}

interface PendingGap {
  kind: 'gap'
  pointerId: number
  origin: Point
  start: Point
}

interface Framing {
  pointerId: number
  origin: Point
  base: string[]
  additive: boolean
  cardBoxes: CardBox[]
  lastClient: Point
  lastTick: number | null
  zoneEnteredAt: number | null
  raf: number
}

interface Sorting {
  pointerId: number
  pageIds: string[]
  targetCards: CardBox[]
  lastClient: Point
  targetIndex: number
}

const scroller = ref<HTMLElement | null>(null)
const marqueeStyle = ref<Record<string, string> | null>(null)
const dropLineStyle = ref<Record<string, string> | null>(null)
let pending: PendingCard | PendingGap | null = null
let framing: Framing | null = null
let sorting: Sorting | null = null

function frameOf(el: HTMLElement, rect: DOMRect): ScrollerFrame {
  return { left: rect.left, top: rect.top, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
}

function cardBoxes(el: HTMLElement, rect: DOMRect, skip: ReadonlySet<string>): CardBox[] {
  const frame = frameOf(el, rect)
  const out: CardBox[] = []
  for (const cardEl of el.querySelectorAll<HTMLElement>('.export-card')) {
    const key = cardEl.dataset.key
    if (key === undefined || skip.has(key)) continue
    const box = cardEl.getBoundingClientRect()
    const at = clientToContent(box.left, box.top, frame)
    out.push({ key, box: { x: at.x, y: at.y, w: box.width, h: box.height } })
  }
  return out
}

function currentRect(f: Framing, el: HTMLElement, rect: DOMRect): Rect {
  const at = clientToContent(f.lastClient.x, f.lastClient.y, frameOf(el, rect))
  return marqueeRect({ origin: f.origin, current: at, constrain: false, fromCenter: false })
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0 || pending !== null || framing !== null || sorting !== null) return
  const el = scroller.value
  if (el === null) return
  const start = { x: e.clientX, y: e.clientY }
  const pageId = (e.target as HTMLElement).closest<HTMLElement>('.export-card')?.dataset.key
  if (pageId !== undefined) {
    pending = { kind: 'card', pointerId: e.pointerId, pageId, start }
    return
  }
  const origin = clientToContent(e.clientX, e.clientY, frameOf(el, el.getBoundingClientRect()))
  pending = { kind: 'gap', pointerId: e.pointerId, origin, start }
}

function beginFraming(pointerId: number, origin: Point, additive: boolean, e: PointerEvent) {
  const el = scroller.value
  if (el === null) return
  framing = {
    pointerId,
    origin,
    base: [...exportSelection.selected],
    additive,
    cardBoxes: cardBoxes(el, el.getBoundingClientRect(), new Set()),
    lastClient: { x: e.clientX, y: e.clientY },
    lastTick: null,
    zoneEnteredAt: null,
    raf: 0,
  }
  framing.raf = requestAnimationFrame(frameTick)
}

function beginSorting(p: PendingCard, e: PointerEvent) {
  const el = scroller.value
  if (el === null) return
  const pageIds = exportSelection.isSelected(p.pageId)
    ? exportSelection.selectedPages.map((f) => f.pageId)
    : [p.pageId]
  sorting = {
    pointerId: p.pointerId,
    pageIds,
    targetCards: cardBoxes(el, el.getBoundingClientRect(), new Set(pageIds)),
    lastClient: { x: e.clientX, y: e.clientY },
    targetIndex: 0,
  }
  updateDropLine()
}

function updateDropLine() {
  const s = sorting
  const el = scroller.value
  if (s === null || el === null) return
  const point = clientToContent(s.lastClient.x, s.lastClient.y, frameOf(el, el.getBoundingClientRect()))
  s.targetIndex = insertionIndexAt(s.targetCards, point)
  const before = s.targetCards[s.targetIndex]
  if (before) {
    dropLineStyle.value = { left: `${before.box.x - 2}px`, top: `${before.box.y}px`, height: `${before.box.h}px` }
    return
  }
  const after = s.targetCards[s.targetCards.length - 1]
  dropLineStyle.value = after
    ? { left: `${after.box.x + after.box.w}px`, top: `${after.box.y}px`, height: `${after.box.h}px` }
    : null
}

function onPointerMove(e: PointerEvent) {
  if (framing !== null) {
    if (e.pointerId !== framing.pointerId) return
    framing.lastClient = { x: e.clientX, y: e.clientY }
    framing.additive = e.ctrlKey || e.metaKey
    return
  }
  if (sorting !== null) {
    if (e.pointerId !== sorting.pointerId) return
    sorting.lastClient = { x: e.clientX, y: e.clientY }
    updateDropLine()
    return
  }
  if (pending === null || e.pointerId !== pending.pointerId) return
  if (Math.hypot(e.clientX - pending.start.x, e.clientY - pending.start.y) < DRAG_THRESHOLD_PX) return
  const p = pending
  pending = null
  if (p.kind === 'gap') {
    beginFraming(p.pointerId, p.origin, e.ctrlKey || e.metaKey, e)
    return
  }
  if (e.ctrlKey || e.metaKey) {
    beginSorting(p, e)
    return
  }
  const el = scroller.value
  if (el === null) return
  const origin = clientToContent(p.start.x, p.start.y, frameOf(el, el.getBoundingClientRect()))
  beginFraming(p.pointerId, origin, false, e)
}

function frameTick(now: number) {
  const f = framing
  const el = scroller.value
  if (f === null || el === null) return
  const rect = el.getBoundingClientRect()
  const dt = f.lastTick === null ? 0 : now - f.lastTick
  f.lastTick = now

  const edge = scrollEdgeFor(currentRect(f, el, rect), el.scrollTop, el.scrollTop + rect.height)
  const factor = edgeDistanceFactor(
    edgeDistance(edge, f.lastClient.y, rect.top, rect.bottom),
    scrollZoneDepth(rect.height),
  )
  if (edge !== null && factor > 0) {
    if (f.zoneEnteredAt === null) f.zoneEnteredAt = now
    const delta = (edgeScrollSpeed(factor, edgeTimeFactor(now - f.zoneEnteredAt)) * dt) / 1000
    el.scrollTop += edge === 'down' ? delta : -delta
  } else {
    f.zoneEnteredAt = null
  }

  const box = currentRect(f, el, rect)
  marqueeStyle.value = {
    left: `${box.x}px`,
    top: `${box.y}px`,
    width: `${box.w}px`,
    height: `${box.h}px`,
  }
  exportSelection.frameSelect(resolveFrame(f.base, touchedKeys(f.cardBoxes, box), f.additive))
  f.raf = requestAnimationFrame(frameTick)
}

function endFraming() {
  if (framing === null) return
  cancelAnimationFrame(framing.raf)
  framing = null
  marqueeStyle.value = null
}

function endSorting(commit: boolean) {
  const s = sorting
  sorting = null
  dropLineStyle.value = null
  if (s === null || !commit) return
  const visible = new Set(project.files.map((f) => f.pageId))
  const before = project.allFiles.map((f) => f.pageId)
  const deleted = before.filter((id) => !visible.has(id))
  editor.cmdSetPageOrder(project.folderPath, before, reorderPages(before, deleted, s.pageIds, s.targetIndex))
}

function onPointerUp(e: PointerEvent) {
  if (framing !== null && e.pointerId === framing.pointerId) return endFraming()
  if (sorting !== null && e.pointerId === sorting.pointerId) return endSorting(true)
  if (pending === null || e.pointerId !== pending.pointerId) return
  const p = pending
  pending = null
  if (p.kind === 'gap') return exportSelection.frameSelect([])
  if (e.shiftKey) exportSelection.extendTo(p.pageId)
  else if (e.ctrlKey || e.metaKey) exportSelection.toggle(p.pageId)
  else exportSelection.only(p.pageId)
}

function onPointerCancel(e: PointerEvent) {
  if (framing !== null && e.pointerId === framing.pointerId) return endFraming()
  if (sorting !== null && e.pointerId === sorting.pointerId) return endSorting(false)
  if (pending !== null && e.pointerId === pending.pointerId) pending = null
}

useEventListener(window, 'pointermove', onPointerMove)
useEventListener(window, 'pointerup', onPointerUp)
useEventListener(window, 'pointercancel', onPointerCancel)

onBeforeUnmount(() => {
  if (framing !== null) cancelAnimationFrame(framing.raf)
})
</script>

<style scoped>
.export-marquee {
  position: absolute;
  z-index: 1;
  border: 1px solid var(--primary);
  background: color-mix(in oklch, var(--primary) 12%, transparent);
  pointer-events: none;
}
.export-drop-line {
  position: absolute;
  z-index: 2;
  width: 3px;
  margin-left: -1px;
  border-radius: 1.5px;
  background: var(--primary);
  pointer-events: none;
}
</style>
