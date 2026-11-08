<template>
  <div
    class="flex h-full min-h-0 flex-col bg-background text-sm select-none"
    @pointerdown="onPress"
    @contextmenu.prevent="onMenu"
  >
    <div class="flex h-7 shrink-0 items-center gap-2 border-b border-border bg-card px-2 text-xs">
      <span class="font-medium">這一話的{{ sideName }}</span>
      <span class="truncate text-muted-foreground tabular-nums">
        {{ pieces.length }} 個 · {{ buckets.length }} 堆 · 按照{{ attributeLabel }}
      </span>
    </div>

    <p v-if="pieces.length === 0" class="p-3 text-xs leading-relaxed text-muted-foreground">
      這一話還沒有{{ sideName }}。
    </p>

    <div v-else ref="bodyEl" class="relative min-h-0 flex-1 space-y-2 overflow-auto p-2">
      <div v-for="bucket in buckets" :key="bucket.key" class="cluster">
        <div class="cluster-label">
          <span v-if="bucket.swatch" class="swatch" :style="{ backgroundColor: bucket.swatch }" />
          <span class="truncate">{{ bucket.label }}</span>
          <span class="ml-auto shrink-0 tabular-nums opacity-70">{{ bucket.items.length }}</span>
        </div>
        <div class="flex flex-wrap items-center gap-1">
          <ShelfPiece
            v-for="item in bucket.items"
            :key="item.id"
            :data-piece-id="item.id"
            :item="item"
            :scale="item.scale * fit"
            :selected="editor.isSelected(item.id)"
            :title="item.title"
          />
        </div>
      </div>
      <ShelfMarquee />
    </div>

    <CanvasMenu :at="arrangeAt" :items="ARRANGEMENTS" @pick="chooseArrangement" @close="arrangeAt = null" />
    <CanvasMenu
      :at="objectMenu.openOn.value?.at ?? null"
      :items="objectMenu.items.value"
      @pick="objectMenu.pick"
      @close="objectMenu.close"
    />
    <CanvasTagPicker :at="objectMenu.tagPickerAt.value" @close="objectMenu.tagPickerAt.value = null" />

    <Teleport to="body">
      <ShelfOverlay />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, ref, shallowRef, useTemplateRef, watchEffect } from 'vue'
import { useElementSize, useEventListener } from '@vueuse/core'
import { strokeOf } from '@shared/effects/stroke'
import type { StrokeEffect } from '@shared/effects/types'
import { plainOf } from '@shared/page/markup'
import type { TextLayerEntry } from '@shared/page/types'
import type { TextStyle } from '@shared/text-style/types'
import CanvasMenu, { type MenuItem } from '@/components/CanvasMenu.vue'
import CanvasTagPicker from '@/components/CanvasTagPicker.vue'
import ShelfPiece from '@/components/materials/ShelfPiece.vue'
import { useObjectMenu } from '@/composables/useObjectMenu'
import type { AppearanceTarget } from '@/lib/appearance'
import {
  forgetShelfPiecesExcept,
  sameHeaps,
  sameItems,
  shelfAttribute,
  shelfEntriesOf,
  shelfPieceOf,
  type ShelfEntry,
  type ShelfHeap,
  type ShelfItem,
} from '@/lib/objectShelf'
import { SHELF_ATTRIBUTES, bucketsByAttribute, type ShelfAttribute } from '@/lib/shelfAttributes'
import { marqueeRect } from '@/lib/selection/marquee'
import type { Point, Rect } from '@/lib/selection/rect'
import {
  clientToContent,
  resolveFrame,
  scrollAlongEdge,
  scrollerFrame,
  touchedKeys,
  type CardBox,
  type EdgeScrolling,
} from '@/lib/selection/shelfMarquee'
import { useEditorStore } from '@/stores/editorStore'
import { useExplodeStore } from '@/stores/explodeStore'
import { objectAtPage } from '@/lib/canvasHit'
import { useProjectStore } from '@/stores/projectStore'

/**
 * The chapter's own text objects as the shelf of materials. Every object of the
 * side being worked on, drawn as its page draws it and gathered into heaps by
 * one arrangement at a time — so the look a line already has is something to
 * reach for rather than something to rebuild.
 *
 * What is selected here is what is selected on the page: there is one selection,
 * and a heap picked apart on the shelf is the same set the canvas and the list
 * are holding.
 */
const editor = useEditorStore()
const explode = useExplodeStore()
const project = useProjectStore()
const objectMenu = useObjectMenu()


const sideName = computed(() => (editor.textSide === 'source' ? '原文' : '譯文'))
const attributeLabel = computed(
  () => SHELF_ATTRIBUTES.find((a) => a.id === shelfAttribute.value)?.label ?? '',
)

/** The whole chapter, which is why no page is named: turning one changes nothing here. */
const shown = computed<ShelfEntry[]>(() =>
  shelfEntriesOf(project.files, editor.textSide, project.activeFace, project.tagsOf),
)

/**
 * The list as it stood when a carry began, held until the hand lets go. Trying
 * a look on changes the objects it lands on, and a list that followed would
 * re-sort and redraw under the hand on every target it passed; it catches up
 * once, with what was really written.
 */
const frozen = shallowRef<ShelfEntry[] | null>(null)
const listed = computed(() => frozen.value ?? shown.value)

/**
 * The pieces and their heaps, handed back unchanged whenever an edit left them
 * so — moving an object, or editing one on a page, rebuilds the chapter's
 * entries, and a fresh list here would redraw every piece of the shelf for an
 * edit none of them shows.
 */
const pieces = computed<ShelfItem[]>((previous) => {
  const next = listed.value.map(shelfPieceOf)
  forgetShelfPiecesExcept(next)
  return previous !== undefined && sameItems(previous, next) ? previous : next
})

const buckets = computed<ShelfHeap[]>((previous) => {
  const byId = new Map(pieces.value.map((p) => [p.id, p]))
  const next = bucketsByAttribute(listed.value, shelfAttribute.value, project.header.tags).map((bucket) => ({
    ...bucket,
    items: bucket.ids
      .flatMap((id) => byId.get(id) ?? [])
      .sort((a, b) => b.sizePx - a.sizePx),
  }))
  return previous !== undefined && sameHeaps(previous, next) ? previous : next
})

/** The order a Shift press reads a range along; an object in two heaps by tag counts where it first appears. */
const sequence = computed(() => [...new Set(buckets.value.flatMap((b) => b.items.map((i) => i.id)))])

const bodyEl = useTemplateRef<HTMLElement>('bodyEl')
const { width: bodyW } = useElementSize(bodyEl)

/**
 * One factor for every piece, so the widest is at most half the room. The sizes
 * keep their proportion to each other; only the whole is brought within reach,
 * which is what lets a narrow column hold a 368px shout.
 */
const fit = computed(() => {
  const widest = Math.max(1, ...pieces.value.map((p) => p.width * p.scale))
  const room = bodyW.value > 0 ? bodyW.value / 2 : Infinity
  return Math.min(1, room / widest)
})

// ── The arrangement ────────────────────────────────────────────────────────

const arrangeAt = ref<{ x: number; y: number } | null>(null)

const ARRANGEMENTS = computed<MenuItem[]>(() =>
  SHELF_ATTRIBUTES.map((a) => ({ id: a.id, label: `按照${a.label}`, checked: a.id === shelfAttribute.value })),
)

function chooseArrangement(id: string) {
  arrangeAt.value = null
  shelfAttribute.value = id as ShelfAttribute
}

/**
 * One listener for every piece and the ground between them. A handler bound on
 * each piece would be a new function on every render of the shelf, and a new
 * listener is a changed prop — every piece would be patched each time.
 */
function onMenu(e: MouseEvent) {
  const id = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-piece-id]')?.dataset.pieceId : undefined
  const piece = id === undefined ? undefined : pieces.value.find((p) => p.id === id)
  if (piece) {
    onPieceMenu(piece, e)
    return
  }
  objectMenu.close()
  arrangeAt.value = { x: e.clientX, y: e.clientY }
}

/**
 * A piece's own menu is the canvas's. Its acts are the open page's, so the
 * chapter turns to the piece first — right-clicking something three pages away
 * and deleting it elsewhere would be a menu lying about what it is for.
 */
function onPieceMenu(item: ShelfItem, e: MouseEvent) {
  arrangeAt.value = null
  if (editor.isSelected(item.id)) editor.showPage(item.pageId)
  else editor.revealLabel(item.pageId, item.id)
  objectMenu.open(item.id, { x: e.clientX, y: e.clientY })
}

// ── Pressing, sweeping, carrying ───────────────────────────────────────────

const CARRY_THRESHOLD_PX = 4

type Pressed =
  | {
      kind: 'piece'
      id: string
      pageId: string
      x: number
      y: number
      /** Where in the piece the press landed, so what is carried hangs from that point. */
      grab: { x: number; y: number }
      shift: boolean
      toggle: boolean
    }
  | { kind: 'sweep'; x: number; y: number; base: readonly string[]; additive: boolean }

/** A sweep past the threshold, kept in the list's content coordinates so it scrolls with the pieces. */
interface Sweep extends EdgeScrolling {
  origin: Point
  base: readonly string[]
  additive: boolean
  boxes: CardBox[]
  lastClient: Point
  picked: string
  raf: number
}

/** The pieces in the hand: all of them, and the one the press landed on. */
interface Carried {
  ids: string[]
  lead: string
  grab: { x: number; y: number }
}

let pressed: Pressed | null = null
let sweep: Sweep | null = null
const marquee = ref<Rect | null>(null)
const carrying = ref<(Carried & { x: number; y: number }) | null>(null)

/**
 * The marquee and the piece that follows the hand, each its own component: both
 * move every frame, and read in the shelf's own render they would redraw every
 * piece of the chapter along with them.
 */
const ShelfMarquee = defineComponent(() => () => {
  const box = marquee.value
  if (box === null) return null
  return h('div', {
    class: 'shelf-marquee',
    style: { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` },
  })
})

const ShelfOverlay = defineComponent(() => () => {
  const held = carrying.value
  const lead = held && pieces.value.find((p) => p.id === held.lead)
  return [
    // Over an object the look is already tried on it, and the piece would only hide that.
    held && lead && plan.value.kind !== 'style'
      ? h('div', { class: 'shelf-carry', style: { left: `${held.x - held.grab.x}px`, top: `${held.y - held.grab.y}px` } }, [
          h(ShelfPiece, { item: lead, scale: lead.scale * fit.value, selected: false, title: '' }),
          held.ids.length > 1 ? h('span', { class: 'shelf-carry-count' }, String(held.ids.length)) : null,
        ])
      : null,
  ]
})

function onPress(e: PointerEvent) {
  if (e.button !== 0) return
  const el = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-piece-id]') : null
  const id = el?.dataset.pieceId
  if (el && id !== undefined) {
    const piece = pieces.value.find((p) => p.id === id)
    if (!piece) return
    e.preventDefault()
    const box = el.getBoundingClientRect()
    pressed = {
      kind: 'piece',
      id,
      pageId: piece.pageId,
      x: e.clientX,
      y: e.clientY,
      grab: { x: e.clientX - box.left, y: e.clientY - box.top },
      shift: e.shiftKey,
      toggle: e.ctrlKey || e.metaKey,
    }
    return
  }
  // A press on the scrollbar is the list being scrolled, not a sweep over it.
  const body = bodyEl.value
  if (body !== null && e.target === body && (e.offsetX >= body.clientWidth || e.offsetY >= body.clientHeight)) return
  pressed = {
    kind: 'sweep',
    x: e.clientX,
    y: e.clientY,
    base: [...editor.selectedIds],
    additive: e.shiftKey || e.ctrlKey || e.metaKey,
  }
}

/**
 * Pieces do not move while a sweep runs — selecting only recolours them — so
 * their boxes are read once, in content coordinates, when it opens.
 */
function beginSweep(from: Pressed & { kind: 'sweep' }, e: PointerEvent) {
  const el = bodyEl.value
  if (el === null) return
  const frame = scrollerFrame(el, el.getBoundingClientRect())
  const boxes: CardBox[] = []
  for (const piece of el.querySelectorAll<HTMLElement>('[data-piece-id]')) {
    const r = piece.getBoundingClientRect()
    const at = clientToContent(r.left, r.top, frame)
    boxes.push({ key: piece.dataset.pieceId!, box: { x: at.x, y: at.y, w: r.width, h: r.height } })
  }
  sweep = {
    origin: clientToContent(from.x, from.y, frame),
    base: from.base,
    additive: from.additive,
    boxes,
    lastClient: { x: e.clientX, y: e.clientY },
    picked: '',
    lastTick: null,
    zoneEnteredAt: null,
    raf: requestAnimationFrame(sweepTick),
  }
}

function sweptRect(s: Sweep, el: HTMLElement, rect: DOMRect): Rect {
  const at = clientToContent(s.lastClient.x, s.lastClient.y, scrollerFrame(el, rect))
  return marqueeRect({ origin: s.origin, current: at, constrain: false, fromCenter: false })
}

/**
 * Once a frame however many moves arrived in it: with DevTools attached
 * Chromium stops merging a frame's mouse moves into one, and a selection
 * written on each of them falls a frame behind for every few it gets.
 */
function sweepTick(now: number) {
  const s = sweep
  const el = bodyEl.value
  if (s === null || el === null) return
  const rect = el.getBoundingClientRect()
  scrollAlongEdge(s, el, rect, sweptRect(s, el, rect), s.lastClient.y, now)
  pickSwept(s, el, rect)
  s.raf = requestAnimationFrame(sweepTick)
}

function pickSwept(s: Sweep, el: HTMLElement, rect: DOMRect) {
  const box = sweptRect(s, el, rect)
  marquee.value = box
  const picked = resolveFrame(s.base, touchedKeys(s.boxes, box), s.additive)
  const key = picked.join(',')
  if (key !== s.picked) {
    s.picked = key
    editor.selectMany(picked, false)
  }
}

function endSweep() {
  if (sweep !== null) cancelAnimationFrame(sweep.raf)
  sweep = null
  marquee.value = null
}

useEventListener(window, 'pointermove', (e: PointerEvent) => {
  const at = pressed
  if (at === null) return
  if (at.kind === 'sweep') {
    if (sweep !== null) sweep.lastClient = { x: e.clientX, y: e.clientY }
    else if (Math.hypot(e.clientX - at.x, e.clientY - at.y) >= CARRY_THRESHOLD_PX) beginSweep(at, e)
    return
  }
  const moved = Math.hypot(e.clientX - at.x, e.clientY - at.y)
  if (carrying.value === null) {
    if (moved < CARRY_THRESHOLD_PX) return
    // A piece that is not held is carried alone, and what is held stays held:
    // reaching for one look must not throw away the set being gathered.
    const ids = editor.isSelected(at.id) ? sequence.value.filter((id) => editor.isSelected(id)) : [at.id]
    frozen.value = shown.value
    carrying.value = { ids, lead: at.id, grab: at.grab, x: e.clientX, y: e.clientY }
  } else {
    carrying.value = { ...carrying.value, x: e.clientX, y: e.clientY }
  }
  showPlan(carrying.value, e.clientX, e.clientY)
})

// ── What letting go would do ───────────────────────────────────────────────

interface Plan {
  kind: 'style' | 'create' | 'none'
  targets: AppearanceTarget<TextLayerEntry>[]
  /** The object under the hand that the look lands through. */
  over?: string
}

/**
 * The frame a look is being tried on, as it stood before trying it. A borrowed
 * font sets the words at another size, the frame grows or shrinks with them,
 * and a hand near its edge would otherwise fall out of it and back in on every
 * move — the trial flickering on and off under a hand held still.
 */
let trialFrame: { id: string; rect: DOMRect } | null = null

function frameRectOf(id: string): DOMRect | null {
  const frame = document.querySelector(`[data-object-id="${CSS.escape(id)}"]`)
  if (frame === null) return null
  let best: DOMRect | null = null
  for (const el of [frame, ...frame.querySelectorAll('*')]) {
    const r = el.getBoundingClientRect()
    if (best === null || r.width * r.height > best.width * best.height) best = r
  }
  return best
}

function withinTrial(x: number, y: number): string | undefined {
  const t = trialFrame
  if (t === null) return undefined
  const r = t.rect
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? t.id : undefined
}

const NOTHING: Plan = { kind: 'none', targets: [] }

const plan = ref<Plan>(NOTHING)

/**
 * The pointer says what letting go would do, as the system's own drags do: a
 * copy over the canvas, where the look or the words land, and the closed hand
 * anywhere else, where letting go puts the piece back. Set on the whole
 * document, since whatever is under the hand — the canvas, a frame, a panel —
 * otherwise shows its own.
 */
const CARRY_CURSOR: Record<Plan['kind'], string> = { style: 'copy', create: 'copy', none: 'grabbing' }

watchEffect(() => {
  const root = document.documentElement
  root.classList.toggle('shelf-carrying', carrying.value !== null)
  root.style.setProperty('--shelf-cursor', CARRY_CURSOR[plan.value.kind])
})
onBeforeUnmount(() => document.documentElement.classList.remove('shelf-carrying'))

/** Where on the open page a screen point lands, or null over a gap between pieces of a split page. */
function pagePointAt(x: number, y: number): { x: number; y: number } | null {
  const canvas = document.querySelector('[data-region="canvas"]')
  if (canvas === null) return null
  const rect = canvas.getBoundingClientRect()
  const origin = { left: rect.left, top: rect.top }
  const region = explode.regionAtScreen(x, y, origin)
  return region === null ? null : explode.pageAtScreen(x, y, origin, region)
}

function objectAt(x: number, y: number): string | undefined {
  const p = pagePointAt(x, y)
  return (p && objectAtPage(p)) ?? undefined
}

/**
 * Who a look lands on: the whole selection where the object let go over is part
 * of it, and that object alone otherwise. Only what is on the open page, since
 * that is what the drop was aimed at.
 */
function lookTargets(overId: string): AppearanceTarget<TextLayerEntry>[] {
  const page = editor.currentPageId
  if (page === null) return []
  if (editor.isSelected(overId)) return editor.selectedTextObjects().filter((t) => t.pageId === page)
  const entry = project.entryById(overId)
  if (entry?.kind !== 'text' || project.pageOfEntry(overId) !== page) return []
  return [{ pageId: page, entry }]
}

function planFor(x: number, y: number, held: Carried): Plan {
  const canvas = document.querySelector('[data-region="canvas"]')
  if (canvas === null || editor.currentPageId === null) return NOTHING
  const rect = canvas.getBoundingClientRect()
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return NOTHING
  const alone = held.ids.length === 1 ? held.ids[0] : undefined
  if (alone !== undefined) {
    const over = withinTrial(x, y) ?? objectAt(x, y)
    const targets = over === undefined || over === alone ? [] : lookTargets(over)
    if (targets.length > 0) return { kind: 'style', targets, over }
  }
  return { kind: 'create', targets: [] }
}

/** The font, the colour and the stroke the piece under the hand is lending. */
function lentLook(held: Carried): { patch: Partial<TextStyle>; stroke: StrokeEffect | null } | null {
  const lead = pieces.value.find((p) => p.id === held.lead)
  if (!lead) return null
  const { fontFamily, fontFace, fontStyleName, color } = lead.style
  return { patch: { fontFamily, fontFace, fontStyleName, color }, stroke: strokeOf(lead.effects) }
}

const planKey = (p: Plan) => `${p.kind}|${p.targets.map((t) => t.entry.id).join(',')}`

/**
 * The look tried on where it would land, so letting go holds no surprise. Only
 * when where it would land changes: trying it on redraws every target, and a
 * hand moving within one object would otherwise redraw them on every move.
 */
function showPlan(held: Carried, x: number, y: number) {
  const next = planFor(x, y, held)
  if (planKey(next) === planKey(plan.value)) return
  plan.value = next
  const look = lentLook(held)
  if (next.kind !== 'style' || look === null) {
    trialFrame = null
    endPreview()
    return
  }
  // Measured before the look goes on, which is the frame the hand was aimed at.
  if (trialFrame?.id !== next.over) {
    endPreview()
    const rect = next.over === undefined ? null : frameRectOf(next.over)
    trialFrame = rect && next.over !== undefined ? { id: next.over, rect } : null
  }
  editor.previewStyle(next.targets, look.patch)
  editor.previewStroke(next.targets, look.stroke)
}

function endPreview() {
  trialFrame = null
  editor.endEffectsPreview()
  editor.endStylePreview()
}

// ── Letting go ─────────────────────────────────────────────────────────────

function click(at: Pressed & { kind: 'piece' }) {
  if (at.shift) editor.extendSelectionTo(at.id, sequence.value)
  else if (at.toggle) editor.toggleSelected(at.id)
  else editor.revealLabel(at.pageId, at.id)
}

/**
 * Every carried piece put down as a sentence of its own, each keeping where it
 * stood against the one under the hand — an armful let go of is one arrangement
 * and not a pile.
 */
function drop(x: number, y: number, held: Carried) {
  const page = editor.currentPageId
  if (page === null) return
  // Let go over a split page: it lands on the piece under the hand, and over
  // the gap between two there is no page to land on.
  const at = pagePointAt(x, y)
  if (at === null) return
  const lead = project.entryById(held.lead)
  if (lead?.kind !== 'text') return
  const byId = new Map(pieces.value.map((p) => [p.id, p]))
  const drops = held.ids.flatMap((id) => {
    const piece = byId.get(id)
    const entry = project.entryById(id)
    if (!piece || entry?.kind !== 'text') return []
    return [
      {
        at: { x: at.x + entry.body.x - lead.body.x, y: at.y + entry.body.y - lead.body.y },
        gives: { text: plainOf(piece.code), patch: { ...piece.style }, effects: piece.effects },
      },
    ]
  })
  editor.cmdAddLabelsFromMaterial(page, drops, editor.textSide)
}

useEventListener(window, 'pointerup', (e: PointerEvent) => {
  const was = pressed
  const held = carrying.value
  const swept = sweep !== null
  if (sweep !== null && bodyEl.value !== null) {
    sweep.lastClient = { x: e.clientX, y: e.clientY }
    pickSwept(sweep, bodyEl.value, bodyEl.value.getBoundingClientRect())
  }
  pressed = null
  carrying.value = null
  endSweep()
  if (held === null) {
    plan.value = NOTHING
    if (!swept && was?.kind === 'piece' && e.button === 0) click(was)
    // A press on the ground between pieces that never became a sweep lets go of
    // the selection, as clicking empty space in a file manager does.
    if (!swept && was?.kind === 'sweep' && !was.additive && e.button === 0) editor.selectOnly(null)
    return
  }
  const landing = planFor(e.clientX, e.clientY, held)
  const look = lentLook(held)
  plan.value = NOTHING
  trialFrame = null
  frozen.value = null
  if (landing.kind === 'style' && look !== null) {
    editor.cmdApplyLentLook(landing.targets, look.patch, look.stroke)
    return
  }
  endPreview()
  if (landing.kind === 'create') drop(e.clientX, e.clientY, held)
})

function cancel() {
  pressed = null
  frozen.value = null
  carrying.value = null
  endSweep()
  plan.value = NOTHING
  endPreview()
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && (carrying.value !== null || sweep !== null || pressed !== null)) cancel()
})

onBeforeUnmount(() => {
  endSweep()
  endPreview()
})
</script>

<style scoped>
.cluster {
  max-width: 100%;
  border-radius: 6px;
  /* Grey rather than paper: white text, white strokes and black ones all have
     to show against it, and on white the first two vanish. */
  background: oklch(0.66 0 0);
  padding: 0.4rem;
}
.cluster-label {
  display: flex;
  width: 100%;
  min-width: 0;
  gap: 0.35rem;
  margin-bottom: 0.3rem;
  font-size: 11px;
  color: #1f1f1f;
}
.swatch {
  width: 0.7rem;
  height: 0.7rem;
  flex-shrink: 0;
  align-self: center;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
}
</style>

<style>
/* Rendered by child components the scoped block does not reach. */
html.shelf-carrying,
html.shelf-carrying * {
  cursor: var(--shelf-cursor) !important;
}
.shelf-marquee {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  border: 1px solid var(--primary);
  background: color-mix(in oklch, var(--primary) 15%, transparent);
}
.shelf-carry {
  position: fixed;
  z-index: 60;
  pointer-events: none;
  opacity: 0.85;
  filter: drop-shadow(0 0.25rem 0.5rem oklch(0 0 0 / 0.35));
}
.shelf-carry-count {
  position: absolute;
  top: -0.5rem;
  right: -0.5rem;
  min-width: 1.1rem;
  border-radius: 9999px;
  background: var(--primary);
  padding: 0 0.3rem;
  text-align: center;
  font-size: 11px;
  line-height: 1.1rem;
  color: var(--primary-foreground);
}
</style>
