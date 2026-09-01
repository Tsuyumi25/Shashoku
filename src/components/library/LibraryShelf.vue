<template>
  <!--
    Positioned, for the notice below: a refused undo in here has to be said
    somewhere the reader is looking, and the same one line the canvas uses is
    the whole of it — a second way of saying "that did not happen" would be a
    second thing to keep in step.
  -->
  <div class="relative flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
      <LibraryCrumbs />

      <ToggleGroupRoot
        type="single"
        class="seg ml-auto shrink-0"
        :model-value="library.view"
        @update:model-value="onView"
      >
        <ToggleGroupItem value="list" class="seg-item shelf-view-item" title="清單">
          <List :size="13" />
        </ToggleGroupItem>
        <ToggleGroupItem value="thumbnail" class="seg-item shelf-view-item" title="格狀">
          <LayoutGrid :size="13" />
        </ToggleGroupItem>
      </ToggleGroupRoot>
    </div>

    <!-- Links rather than a tablist: a tablist hides its inactive panels from
         the accessibility tree, and every band here is on screen at once. -->
    <nav v-if="library.bandCount > 1" class="jump">
      <a
        v-if="library.standingAt !== null"
        class="jump-item"
        href="#library-band-pages"
        @click="flash('pages')"
      >
        頁面
        <span v-if="library.bandPages.length > 0" class="jump-count">
          {{ library.bandPages.length }}
        </span>
      </a>
      <a
        v-if="library.bandProjects.length > 0"
        class="jump-item"
        href="#library-band-projects"
        @click="flash('projects')"
      >
        書 <span class="jump-count">{{ library.bandProjects.length }}</span>
      </a>
      <a
        v-if="library.bandFiles.length > 0"
        class="jump-item"
        href="#library-band-files"
        @click="flash('files')"
      >
        檔案 <span class="jump-count">{{ library.bandFiles.length }}</span>
      </a>
    </nav>

    <div
      ref="scroller"
      class="shelf-scroll"
      @pointerdown="onShelfPointerDown"
    >
      <p v-if="isEmpty" class="px-2 py-8 text-center text-sm text-muted-foreground">
        {{ emptyText }}
      </p>

      <div v-else-if="library.standingAt === null" data-region="project" :class="gridClass">
        <LibraryCard
          v-for="entry in library.home"
          :key="entry.path"
          class="shelf-card"
          :data-key="entryKey(entry)"
          :entry="entry"
          :view="library.view"
          :picked="library.isChosen(entryKey(entry))"
          :open="entry.path === project.folderPath"
          @enter="library.standAt(entry.path)"
        />
      </div>

      <template v-else>
        <section
          id="library-band-pages"
          data-region="project"
          class="band band-document"
          :class="[flashing === 'pages' && 'band-arrived', library.focus === 'project' && 'band-focused']"
        >
          <p class="band-head">
            頁面
            <span v-if="library.bandPages.length > 0" class="band-count">
              {{ library.bandPages.length }}
            </span>
          </p>
          <div v-if="library.bandPages.length > 0" :class="gridClass">
            <LibraryLeafCard
              v-for="leaf in library.bandPages"
              :key="leaf.id"
              class="shelf-card"
              :data-key="pageKey(leaf)"
              :leaf="leaf"
              :view="library.view"
              :picked="library.isChosen(pageKey(leaf))"
              @enter="openLeaf(leaf)"
            />
          </div>
          <p v-else class="page-drop" :class="dropping && 'page-drop-ready'">
            <span>
              用 Ctrl + 拖曳把下面的圖片放進來，在這個資料夾裡建立 Shashoku 專案
            </span>
          </p>
        </section>

        <section
          v-if="library.bandProjects.length > 0"
          id="library-band-projects"
          data-region="project"
          class="band band-document"
          :class="[flashing === 'projects' && 'band-arrived', library.focus === 'project' && 'band-focused']"
        >
          <p class="band-head">
            書 <span class="band-count">{{ library.bandProjects.length }}</span>
          </p>
          <div :class="gridClass">
            <LibraryCard
              v-for="entry in library.bandProjects"
              :key="entry.path"
              class="shelf-card"
              :data-key="entryKey(entry)"
              :entry="entry"
              :view="library.view"
              :picked="library.isChosen(entryKey(entry))"
              :open="entry.path === project.folderPath"
              @enter="enter(entry)"
            />
          </div>
        </section>

        <section
          v-if="library.bandFiles.length > 0"
          id="library-band-files"
          data-region="file"
          class="band"
          :class="[flashing === 'files' && 'band-arrived', library.focus === 'file' && 'band-focused']"
        >
          <p class="band-head">
            檔案 <span class="band-count">{{ library.bandFiles.length }}</span>
          </p>
          <div :class="gridClass">
            <LibraryCard
              v-for="entry in library.bandFiles"
              :key="entry.path"
              class="shelf-card"
              :data-key="entryKey(entry)"
              :entry="entry"
              :view="library.view"
              :picked="library.isChosen(entryKey(entry))"
              :open="false"
              @enter="enter(entry)"
            />
          </div>
        </section>
      </template>

      <div v-if="marqueeStyle" class="shelf-marquee" :style="marqueeStyle" />
      <div v-if="dropLineStyle" class="shelf-drop-line" :style="dropLineStyle" />
    </div>

    <Notice />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { LayoutGrid, List } from '@lucide/vue'
import { ToggleGroupItem, ToggleGroupRoot } from 'reka-ui'
import { useToast } from 'vue-toastification'
import type { DirEntry, ShelfLeaf } from '@shared/project/workspace'
import LibraryCard from '@/components/library/LibraryCard.vue'
import LibraryCrumbs from '@/components/library/LibraryCrumbs.vue'
import LibraryLeafCard from '@/components/library/LibraryLeafCard.vue'
import Notice from '@/components/Notice.vue'
import { useLibraryPageOrder } from '@/composables/useLibraryPageOrder'
import { useOpenProject } from '@/composables/useOpenProject'
import { marqueeRect } from '@/lib/selection/marquee'
import type { Point, Rect } from '@/lib/selection/rect'
import { routeShelfKey } from '@/lib/selection/shelfKeys'
import { insertionIndexAt } from '@/lib/selection/shelfDrop'
import {
  bandBoundary,
  clampToTerritory,
  clientToContent,
  DRAG_THRESHOLD_PX,
  edgeDistance,
  edgeDistanceFactor,
  edgeScrollSpeed,
  edgeTimeFactor,
  resolveFrame,
  scrollEdgeFor,
  scrollZoneDepth,
  territoryAt,
  touchedKeys,
  type CardBox,
} from '@/lib/selection/shelfMarquee'
import { isTypingSurface } from '@/lib/typingSurface'
import { useEditorStore } from '@/stores/editorStore'
import { entryKey, pageKey, type ShelfRegion, useLibraryStore } from '@/stores/libraryStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const library = useLibraryStore()
const project = useProjectStore()
const editor = useEditorStore()
const ui = useUiStore()
const order = useLibraryPageOrder()
const { openPath, lastError } = useOpenProject()
const toast = useToast()

const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] items-start gap-2'

/** Kept in step with the animation in the stylesheet below. */
const FLASH_MS = 1500
const NO_SCROLL_MS = 120
const ARMED_MS = 3000

// Only the root is ever empty now: every folder stood in draws a page band,
// and an empty one is the zone a folder becomes a book through.
const isEmpty = computed(
  () => !library.insideLoading && library.standingAt === null && library.home.length === 0,
)

const emptyText = computed(() =>
  library.roots.length === 0
    ? '左邊按「加入工作區」，把一個裝著書的資料夾放進來。'
    : '還沒有工作區。',
)

// A single-value toggle group can also clear itself, and there is no such thing
// as showing the shelf in no view at all.
function onView(v: unknown) {
  if (v === 'list' || v === 'thumbnail') library.view = v
}

/**
 * ⚠️ `scrollend` never fires when the scroll position did not change, and a
 * smooth scroll is not obliged to have started by the next frame. So a first
 * `scroll` is what says one is coming, and its absence is what says none is.
 */
const scroller = ref<HTMLElement | null>(null)
const flashing = ref<string | null>(null)
let armed: string | null = null
let settleTimer = 0
let disarmTimer = 0
let flashTimer = 0

function flash(band: string) {
  armed = band
  window.clearTimeout(settleTimer)
  window.clearTimeout(disarmTimer)
  settleTimer = window.setTimeout(() => {
    if (armed === band) fire(band)
  }, NO_SCROLL_MS)
  disarmTimer = window.setTimeout(() => {
    armed = null
  }, ARMED_MS)
}

function fire(band: string) {
  armed = null
  window.clearTimeout(settleTimer)
  window.clearTimeout(disarmTimer)
  window.clearTimeout(flashTimer)
  flashing.value = null
  // Re-adding a class to the same element does not restart its animation.
  requestAnimationFrame(() => {
    flashing.value = band
    flashTimer = window.setTimeout(() => {
      flashing.value = null
    }, FLASH_MS)
  })
}

useEventListener(scroller, 'scroll', () => {
  if (armed !== null) window.clearTimeout(settleTimer)
})

useEventListener(scroller, 'scrollend', () => {
  if (armed !== null) fire(armed)
})

onBeforeUnmount(() => {
  window.clearTimeout(settleTimer)
  window.clearTimeout(disarmTimer)
  window.clearTimeout(flashTimer)
  if (framing !== null) cancelAnimationFrame(framing.raf)
})

function cards(): HTMLElement[] {
  const root = scroller.value
  return root ? [...root.querySelectorAll<HTMLElement>('.shelf-card')] : []
}

// ── Drag to select, reorder, or import ─────────────────────────────────────
//
// One state machine serves a click on a card, a marquee dragged through the
// grid, and a Ctrl+Drag that moves cards into the page band, because one
// mousedown has to decide which it is turning into. Nothing about the
// selection changes until either the drag threshold is crossed or the
// pointer comes back up — a press on an already-chosen card must be free to
// become "drag this whole batch" without collapsing it to one first. Once
// the threshold is crossed, `pending` is spent: it becomes a `Framing` (plain
// drag, from anywhere) or a `Sorting` (Ctrl+Drag from a card, inside a book).

interface PendingCard {
  kind: 'card'
  pointerId: number
  key: string
  region: ShelfRegion
  start: Point
}

interface PendingGap {
  kind: 'gap'
  pointerId: number
  region: ShelfRegion
  boundary: number
  origin: Point
  start: Point
}

interface Framing {
  pointerId: number
  origin: Point
  territory: ShelfRegion
  boundary: number
  base: string[]
  additive: boolean
  cardBoxes: CardBox[]
  lastClient: Point
  lastTick: number | null
  zoneEnteredAt: number | null
  raf: number
}

/**
 * A Ctrl+Drag let go from a card: everything selected travels together — or
 * just the one card, if it was not part of the selection when the press
 * landed — to the page band's `targetIndex`. `targetCards` is read once, when
 * the drag opens, the same way `Framing.cardBoxes` is: nothing here is
 * virtualized, so the grid does not reflow mid-drag.
 */
interface Sorting {
  pointerId: number
  book: string
  kind: 'reorder' | 'import'
  /** The folder is not a book yet, so letting go has to make it one first. */
  create: boolean
  /** Populated for `'reorder'`, natural (band) order — never selection order. */
  pageIds: string[]
  /** Populated for `'import'`, natural (band) order. */
  sourceNames: string[]
  targetCards: CardBox[]
  lastClient: Point
  targetIndex: number
}

let pending: PendingCard | PendingGap | null = null
let framing: Framing | null = null
let sorting: Sorting | null = null
const marqueeStyle = ref<Record<string, string> | null>(null)
const dropLineStyle = ref<Record<string, string> | null>(null)
/** Reactive where `sorting` is not: the empty page band lights up from it. */
const dropping = ref(false)

function scrollerFrame(el: HTMLElement, rect: DOMRect) {
  return { left: rect.left, top: rect.top, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }
}

/**
 * Where the line between the two bands sits, in content coordinates. Read
 * off the DOM once per gesture rather than kept as layout state: nothing
 * here is virtualized, so the two band containers are simply asked where
 * they are.
 */
function territoryBoundary(el: HTMLElement, rect: DOMRect): number {
  const toContentY = (clientY: number) => clientY - rect.top + el.scrollTop
  // The last of them: the project territory is drawn as a page section and a
  // book section, and the line the file band starts after is below both.
  const projects = el.querySelectorAll<HTMLElement>('[data-region="project"]')
  const project = projects.length > 0 ? projects[projects.length - 1] : null
  const file = el.querySelector<HTMLElement>('[data-region="file"]')
  return bandBoundary(
    project ? toContentY(project.getBoundingClientRect().bottom) : null,
    file ? toContentY(file.getBoundingClientRect().top) : null,
  )
}

/**
 * Every card's box in one territory, taken once when a drag opens rather
 * than every frame it runs — the grid does not reflow while a marquee is
 * live, only the scroll position and the box being tested against it do.
 */
function cardBoxesIn(el: HTMLElement, rect: DOMRect, territory: ShelfRegion): CardBox[] {
  const frame = scrollerFrame(el, rect)
  const out: CardBox[] = []
  for (const cardEl of cards()) {
    const key = cardEl.dataset.key
    if (key === undefined || library.regionOf(key) !== territory) continue
    const box = cardEl.getBoundingClientRect()
    const at = clientToContent(box.left, box.top, frame)
    out.push({ key, box: { x: at.x, y: at.y, w: box.width, h: box.height } })
  }
  return out
}

function currentRect(f: Framing, el: HTMLElement, rect: DOMRect): Rect {
  const at = clientToContent(f.lastClient.x, f.lastClient.y, scrollerFrame(el, rect))
  const raw = marqueeRect({ origin: f.origin, current: at, constrain: false, fromCenter: false })
  return clampToTerritory(raw, f.territory, f.boundary)
}

function onShelfPointerDown(e: PointerEvent) {
  if (e.button !== 0 || pending !== null || framing !== null || sorting !== null) return
  const el = scroller.value
  if (el === null) return
  const start = { x: e.clientX, y: e.clientY }
  const cardEl = (e.target as HTMLElement).closest<HTMLElement>('.shelf-card')
  const key = cardEl?.dataset.key
  if (key !== undefined) {
    const region = library.regionOf(key)
    if (region === null) return
    pending = { kind: 'card', pointerId: e.pointerId, key, region, start }
    return
  }
  const rect = el.getBoundingClientRect()
  const origin = clientToContent(e.clientX, e.clientY, scrollerFrame(el, rect))
  const boundary = territoryBoundary(el, rect)
  pending = {
    kind: 'gap',
    pointerId: e.pointerId,
    region: territoryAt(origin.y, boundary),
    boundary,
    origin,
    start,
  }
}

/**
 * Opens a marquee wherever it is asked to — the gap branch already knows its
 * origin and boundary from `pointerdown`; a plain drag that started on a card
 * has to work them out fresh here, since the card branch never keeps them
 * (Ctrl held on a card means something else entirely).
 */
function beginFraming(
  pointerId: number,
  region: ShelfRegion,
  origin: Point,
  boundary: number,
  additive: boolean,
  e: PointerEvent,
): void {
  const el = scroller.value
  if (el === null) return
  const rect = el.getBoundingClientRect()
  framing = {
    pointerId,
    origin,
    territory: region,
    boundary,
    base: library.chosenIn(region),
    additive,
    cardBoxes: cardBoxesIn(el, rect, region),
    lastClient: { x: e.clientX, y: e.clientY },
    lastTick: null,
    zoneEnteredAt: null,
    raf: 0,
  }
  framing.raf = requestAnimationFrame(frameTick)
}

/**
 * A page or a file card dragged past the threshold with Ctrl held. The page
 * band it lands in exists in every folder, so a folder that is not a book yet
 * is a target too — letting go there is what turns it into one.
 *
 * ⛔ Only a picture can become a page. The file band also carries folders and
 * the book's own `shashoku/`, and a drop that took one of those would hand
 * `createPage` a directory to read as an image.
 */
function beginSorting(p: PendingCard, e: PointerEvent): boolean {
  if (settling > 0) return false
  const book = library.standingAt
  if (book === null) return false
  const el = scroller.value
  if (el === null) return false
  const rect = el.getBoundingClientRect()

  const movingKeys = new Set(
    library.isChosen(p.key) ? library.chosenIn(p.region) : [p.key],
  )
  const source = p.region === 'project' ? library.projectItems : library.fileItems
  const moving = source.filter((item) => movingKeys.has(item.key))
  if (moving.length === 0) return false

  const pageIds = moving.flatMap((item) => (item.kind === 'page' ? [item.page.id] : []))
  const sourceNames = moving.flatMap((item) =>
    item.kind === 'entry' && !item.entry.folder && item.entry.cover !== null
      ? [item.entry.name]
      : [],
  )
  const kind = pageIds.length > 0 ? 'reorder' : 'import'
  if (kind === 'import' && sourceNames.length === 0) return false

  // Only the pages: the project territory draws the books standing in this
  // folder beside them, and a drop lands among pages alone.
  const pageKeys = new Set(library.bandPages.map(pageKey))
  const excluded = kind === 'reorder' ? movingKeys : new Set<string>()
  const pageBoxes = cardBoxesIn(el, rect, 'project').filter(
    (c) => pageKeys.has(c.key) && !excluded.has(c.key),
  )

  sorting = {
    pointerId: p.pointerId,
    book,
    kind,
    create: !library.inside.book,
    pageIds,
    sourceNames,
    targetCards: pageBoxes,
    lastClient: { x: e.clientX, y: e.clientY },
    targetIndex: 0,
  }
  dropping.value = true
  updateSortingPreview()
  return true
}

/** Where `sorting`'s cards land, and the thin line drawn to show it. */
function updateSortingPreview(): void {
  const s = sorting
  const el = scroller.value
  if (s === null || el === null) return
  const rect = el.getBoundingClientRect()
  const point = clientToContent(s.lastClient.x, s.lastClient.y, scrollerFrame(el, rect))
  s.targetIndex = insertionIndexAt(s.targetCards, point)

  // A line drawn at the leading edge of whichever card the drop lands
  // before, or trailing the last card once the drop is past all of them.
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

function onShelfPointerMove(e: PointerEvent) {
  if (framing !== null) {
    if (e.pointerId !== framing.pointerId) return
    framing.lastClient = { x: e.clientX, y: e.clientY }
    framing.additive = e.ctrlKey || e.metaKey
    return
  }
  if (sorting !== null) {
    if (e.pointerId !== sorting.pointerId) return
    sorting.lastClient = { x: e.clientX, y: e.clientY }
    updateSortingPreview()
    return
  }
  if (pending === null || e.pointerId !== pending.pointerId) return
  if (Math.hypot(e.clientX - pending.start.x, e.clientY - pending.start.y) < DRAG_THRESHOLD_PX) return
  if (pending.kind === 'card') {
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl) {
      // Consumes the gesture either way: a card+Ctrl drag outside a book has
      // nowhere defined to land, and is a no-op rather than falling back to
      // a marquee — Ctrl already means something else on a card.
      beginSorting(pending, e)
      pending = null
      return
    }
    const el = scroller.value
    if (el === null) {
      pending = null
      return
    }
    const rect = el.getBoundingClientRect()
    const origin = clientToContent(pending.start.x, pending.start.y, scrollerFrame(el, rect))
    const boundary = territoryBoundary(el, rect)
    beginFraming(pending.pointerId, pending.region, origin, boundary, false, e)
    pending = null
    return
  }
  beginFraming(
    pending.pointerId,
    pending.region,
    pending.origin,
    pending.boundary,
    e.ctrlKey || e.metaKey,
    e,
  )
  pending = null
}

/**
 * The auto-scroll loop. Not driven by `pointermove`, which stops arriving
 * the moment the pointer holds still at the edge — this runs every frame
 * regardless, measuring distance, turning it into a speed, scrolling, and
 * only then re-reading the content point the scroll just moved underneath
 * the pointer.
 */
function frameTick(now: number) {
  const f = framing
  const el = scroller.value
  if (f === null || el === null) return
  const rect = el.getBoundingClientRect()
  const dt = f.lastTick === null ? 0 : now - f.lastTick
  f.lastTick = now

  const viewportTop = el.scrollTop
  const viewportBottom = el.scrollTop + rect.height
  const before = currentRect(f, el, rect)
  const edge = scrollEdgeFor(before, viewportTop, viewportBottom)
  const zoneDepth = scrollZoneDepth(rect.height)
  const distance = edgeDistance(edge, f.lastClient.y, rect.top, rect.bottom)
  const factor = edgeDistanceFactor(distance, zoneDepth)

  if (edge !== null && factor > 0) {
    if (f.zoneEnteredAt === null) f.zoneEnteredAt = now
    const speed = edgeScrollSpeed(factor, edgeTimeFactor(now - f.zoneEnteredAt))
    const delta = (speed * dt) / 1000
    el.scrollTop += edge === 'down' ? delta : -delta
  } else {
    f.zoneEnteredAt = null
  }

  const clamped = currentRect(f, el, rect)
  marqueeStyle.value = {
    left: `${clamped.x}px`,
    top: `${clamped.y}px`,
    width: `${clamped.w}px`,
    height: `${clamped.h}px`,
  }
  const hits = touchedKeys(f.cardBoxes, clamped)
  library.frameSelect(f.territory, resolveFrame(f.base, hits, f.additive))

  f.raf = requestAnimationFrame(frameTick)
}

function endFraming() {
  if (framing === null) return
  cancelAnimationFrame(framing.raf)
  framing = null
  marqueeStyle.value = null
}

/**
 * Where letting go actually pushes the command — the gesture itself only
 * ever previewed a target index. `reorderPagesTo`/`importFilesAt` each build
 * one `Command` for the whole batch, so `Ctrl+Z` takes it all back in one
 * step regardless of how many cards were dragged.
 */
/**
 * How many drops are still on their way to disk. A gesture measures its drop
 * index against the cards as they stand, so one begun while the last is still
 * landing would be read against a grid that is about to move under it. The
 * queue in `useLibraryPageOrder` is what keeps the orders correct; this is
 * what keeps the pointer from aiming at a layout that has not settled.
 */
let settling = 0

function endSorting(): void {
  const s = sorting
  sorting = null
  dropLineStyle.value = null
  dropping.value = false
  if (s === null) return
  settling++
  const done = () => {
    settling--
  }
  if (s.kind === 'reorder') {
    // No reload: the band is laid out from the store that owns the book, so
    // it has already moved. Re-reading the folder is what an undo cannot do
    // and must not have to.
    void order.reorderPagesTo(s.book, s.pageIds, s.targetIndex).then(done, done)
    return
  }
  // An import is the one case that does need the folder read again — its
  // pages have no card yet, and their names and covers are on disk. A folder
  // that has just become a book needs the whole walk instead: the side column
  // counts books, and one has appeared where there was none.
  void order
    .importFilesAt(s.book, s.sourceNames, s.targetIndex, s.create)
    .then(() => (s.create ? library.refresh() : library.reloadInside()))
    .then(done, done)
}

function onShelfPointerUp(e: PointerEvent) {
  if (framing !== null && e.pointerId === framing.pointerId) {
    endFraming()
    return
  }
  if (sorting !== null && e.pointerId === sorting.pointerId) {
    endSorting()
    return
  }
  if (pending === null || e.pointerId !== pending.pointerId) return
  const done = pending
  pending = null
  if (done.kind === 'card') {
    // Reaching here at all means the press never crossed the drag threshold —
    // once it does, `pending` is spent into a `Framing` or a `Sorting` and
    // pointerup takes one of the branches above instead.
    if (e.shiftKey) library.extendTo(done.region, done.key)
    else if (e.ctrlKey || e.metaKey) library.toggle(done.region, done.key)
    else library.only(done.region, done.key)
    return
  }
  // A gap press that never crossed the threshold is a click on empty space:
  // an empty marquee, which hits nothing and so clears the band it landed in.
  library.frameSelect(done.region, [])
}

function onShelfPointerCancel(e: PointerEvent) {
  if (framing !== null && e.pointerId === framing.pointerId) {
    endFraming()
    return
  }
  if (sorting !== null && e.pointerId === sorting.pointerId) {
    sorting = null
    dropLineStyle.value = null
    dropping.value = false
    return
  }
  if (pending !== null && e.pointerId === pending.pointerId) pending = null
}

// On the window rather than the scroller, and without pointer capture:
// capturing retargets the compatibility mouse events too, which takes the
// double click that opens a card away from the card.
useEventListener(window, 'pointermove', onShelfPointerMove)
useEventListener(window, 'pointerup', onShelfPointerUp)
useEventListener(window, 'pointercancel', onShelfPointerCancel)

/**
 * Where an arrow lands, read off the boxes on screen rather than off the list.
 * The grid wraps at whatever width the panel happens to be and its rows are
 * broken by the band headings, so the row above is a question only the layout
 * can answer.
 */
function step(across: number, down: number): string | null {
  const els = cards()
  if (els.length === 0) return null
  const at = els.findIndex((el) => el.dataset.key === library.cursor)
  if (at === -1) return els[0].dataset.key ?? null
  if (across !== 0) return (els[at + across] ?? els[at]).dataset.key ?? null

  const from = els[at].getBoundingClientRect()
  const middle = from.left + from.width / 2
  let best: HTMLElement | null = null
  let nearest = Infinity
  for (const el of els) {
    const box = el.getBoundingClientRect()
    const away = down > 0 ? box.top - from.top : from.top - box.top
    if (away <= 1) continue
    const reach = away * 10000 + Math.abs(box.left + box.width / 2 - middle)
    if (reach < nearest) {
      nearest = reach
      best = el
    }
  }
  return best?.dataset.key ?? library.cursor
}

function walk(across: number, down: number, extend: boolean) {
  const key = step(across, down)
  if (key === null) return
  const region = library.regionOf(key)
  if (region === null) return
  // Shift reaches within the band it started in; a step that would leave it
  // stops here instead of crossing, as a marquee's edge would.
  if (extend && region !== library.focus) return
  if (extend) library.extendTo(region, key)
  else library.only(region, key)
  // Against the stylesheet's smooth scrolling, which is there for the band
  // links: an arrow key has already moved the cursor, and animating after it
  // shows the wrong card for as long as the animation lasts.
  cards()
    .find((el) => el.dataset.key === key)
    ?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
}

function activate() {
  const key = library.cursor
  if (key === null) return
  const item =
    library.projectItems.find((each) => each.key === key) ??
    library.fileItems.find((each) => each.key === key)
  if (item === undefined) return
  if (item.kind === 'page') void openLeaf(item.page)
  else enter(item.entry)
}

function workspaceRowFocused(): boolean {
  return document.activeElement?.closest('[data-lib-row]') != null
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (ui.settingsOpen || ui.view !== 'library') return
  if (isTypingSurface(document.activeElement)) return

  const action = routeShelfKey(e, workspaceRowFocused())
  if (action === null) return
  e.preventDefault()

  switch (action.type) {
    case 'chooseAll':
      return library.chooseAll()
    case 'clear':
      return library.clearChoice()
    case 'walk':
      return walk(action.across, action.down, action.extend)
    case 'activate':
      return activate()
  }
})

function enter(entry: DirEntry) {
  if (entry.folder) library.standAt(entry.path)
}

async function openLeaf(leaf: ShelfLeaf) {
  const book = library.standingAt
  if (!leaf.page || book === null) return
  if (book !== project.folderPath && !(await openPath(book))) {
    if (lastError.value) toast.error(lastError.value)
    return
  }
  editor.startOnPage(leaf.id)
  ui.setView('editor')
}

onMounted(() => {
  void library.refresh()
})
</script>

<style scoped>
.shelf-view-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.625rem;
  padding: 0;
}

.jump {
  display: flex;
  flex-shrink: 0;
  gap: 0.25rem;
  padding: 0.375rem 0.75rem 0;
  scroll-target-group: auto;
}
.jump-item {
  padding: 0.125rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
  text-decoration: none;
  white-space: nowrap;
  transition: color 120ms ease, background 120ms ease;
}
.jump-item:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.jump-item:target-current {
  color: var(--foreground);
}
.jump-count {
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.shelf-scroll {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
  user-select: none;
}

/* A child of the scroller it is positioned against, so its `left`/`top` are
   the same content coordinates the drag itself is tracked in — no further
   projection needed, and it scrolls with the cards rather than over them. */
.shelf-marquee {
  position: absolute;
  z-index: 1;
  border: 1px solid var(--primary);
  background: color-mix(in oklch, var(--primary) 12%, transparent);
  pointer-events: none;
}
/* Same coordinate system as `.shelf-marquee`, for the same reason — a
   Ctrl+Drag's own position in the page band. */
.shelf-drop-line {
  position: absolute;
  z-index: 2;
  width: 3px;
  margin-left: -1px;
  border-radius: 1.5px;
  background: var(--primary);
  pointer-events: none;
}
.band {
  padding: 0.5rem;
  border-radius: 0.375rem;
  scroll-margin-top: 0.5rem;
}
.band-document {
  background: color-mix(in oklch, var(--primary) 7%, transparent);
}
.band-head {
  margin-bottom: 0.375rem;
  padding: 0.0625rem 0.25rem;
  border-radius: 0.1875rem;
  font-size: 0.75rem;
  color: var(--muted-foreground);
}
.band-count {
  margin-left: 0.25rem;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

/* Two cells of the grid above it — the same 9rem column at the 3/4 the covers
   are drawn in — so an empty band reads as somewhere pages go rather than as
   a gap. Capped against the viewport: a short window would otherwise have
   nothing but this on screen. */
.page-drop {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: min(calc(2 * 9rem * 4 / 3 + 0.5rem), 40vh);
  padding: 1rem;
  border: 1px dashed color-mix(in oklch, var(--primary) 35%, transparent);
  border-radius: 0.375rem;
  text-align: center;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--muted-foreground);
  transition: border-color 120ms ease, background 120ms ease, color 120ms ease;
}
.page-drop span {
  max-width: 22rem;
}
.page-drop-ready {
  border-color: var(--primary);
  background: color-mix(in oklch, var(--primary) 10%, transparent);
  color: var(--foreground);
}

/* -1px and inset both answer the same 8px gap between bands (.shelf-scroll's
   gap): an outward glow, or an outline drawn on the default outer edge,
   would bleed into the band next door. */
.band-focused {
  outline: 1px solid color-mix(in oklch, var(--primary) 45%, transparent);
  outline-offset: -1px;
}

@keyframes band-arrived {
  0% {
    box-shadow: inset 0 0 24px 2px color-mix(in oklch, var(--primary) 40%, transparent);
  }
  100% {
    box-shadow: inset 0 0 24px 2px transparent;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .shelf-scroll {
    scroll-behavior: smooth;
  }
  .band-arrived {
    animation: band-arrived 1500ms ease-out;
  }
}
</style>
