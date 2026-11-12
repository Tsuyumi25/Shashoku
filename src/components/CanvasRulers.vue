<template>
  <!--
    Screen chrome over the canvas: the page's guides on one canvas, and the two
    rulers along the top and left edges. Only the rulers take the pointer; a
    guide is picked up through `hitAt`, from the canvas's own press.
  -->
  <div
    ref="rootRef"
    class="pointer-events-none absolute inset-0"
    @pointermove.stop="onDragMove"
    @pointerup.stop="onDragEnd"
    @pointercancel.stop="cancelDrag"
    @lostpointercapture="cancelDrag"
  >
    <canvas ref="guidesRef" class="absolute inset-0 h-full w-full" />
    <template v-if="preferences.prefs.rulersShown">
      <!--
        A canvas keeps its own aspect: given one side it sizes the other from
        its bitmap, so each ruler is told both its length and its thickness.
      -->
      <canvas
        ref="topRef"
        data-ruler
        class="pointer-events-auto absolute top-0 left-0 w-full cursor-row-resize"
        :style="{ height: `${RULER_PX}px` }"
        @pointerdown.stop.prevent="(e) => beginNew(e, 'horizontal')"
      />
      <canvas
        ref="leftRef"
        data-ruler
        class="pointer-events-auto absolute top-0 left-0 h-full cursor-col-resize"
        :style="{ width: `${RULER_PX}px` }"
        @pointerdown.stop.prevent="(e) => beginNew(e, 'vertical')"
      />
      <div
        data-ruler
        class="pointer-events-auto absolute top-0 left-0 border-r border-b border-border bg-card"
        :style="{ width: `${RULER_PX}px`, height: `${RULER_PX}px` }"
      />
    </template>
    <CanvasMenu :at="menu?.at ?? null" :items="MENU_ITEMS" @pick="onMenuPick" @close="menu = null" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { PageGuide } from '@shared/page/types'
import CanvasMenu, { type MenuItem } from '@/components/CanvasMenu.vue'
import { applyViewTransform, type Anchor, type ViewTransform } from '@/lib/coords'
import { paintPieces } from '@/lib/explode/pieces'
import { levelView, nearestWithin, RULER_PX, rulerSteps, SNAP_PX, type Segment } from '@/lib/rulers'
import { ownsKeyboard } from '@/lib/typingSurface'
import { useEditorStore } from '@/stores/editorStore'
import { useExplodeStore, WHOLE_PAGE } from '@/stores/explodeStore'
import { usePreferencesStore } from '@/stores/preferencesStore'
import { useProjectStore } from '@/stores/projectStore'
import { useUiStore } from '@/stores/uiStore'

const props = defineProps<{
  /** Where the pointer is over the canvas, in its own pixels, or null when it is elsewhere. */
  pointer: { x: number; y: number } | null
  /** Lines a guide being dragged takes hold of, in page pixels: `x` for vertical guides, `y` for horizontal. */
  snapLines: () => { x: number[]; y: number[] }
  /** Smart guides a dragged object shows while it holds to another object or the page, in page pixels. */
  held: readonly Segment[]
}>()

const editor = useEditorStore()
const explode = useExplodeStore()
const preferences = usePreferencesStore()
const project = useProjectStore()
const ui = useUiStore()

const rootRef = ref<HTMLElement | null>(null)
const guidesRef = ref<HTMLCanvasElement | null>(null)
const topRef = ref<HTMLCanvasElement | null>(null)
const leftRef = ref<HTMLCanvasElement | null>(null)

/** How near the pointer has to come to a guide to pick it up, in screen pixels. */
const PICK_PX = 4

/** How far a press on a guide has to travel before it moves the guide rather than selecting it. */
const DRAG_PX = 3

const guides = computed<readonly PageGuide[]>(() =>
  editor.currentPageId === null ? [] : project.guidesOf(editor.currentPageId),
)

/** The guide a click picked, drawn darker, which Delete takes away. */
const selectedId = ref<string | null>(null)
watch(
  () => editor.currentPageId,
  () => {
    selectedId.value = null
    menu.value = null
    // A guide in hand belongs to the page it was taken on, and must not land on another.
    cancelDrag()
  },
)

function clearSelection() {
  selectedId.value = null
}

function deleteGuide(id: string) {
  const page = editor.currentPageId
  if (page !== null) editor.cmdDeleteGuide(page, id)
  if (selectedId.value === id) selectedId.value = null
}

// Ahead of the editor's own Delete, which would otherwise take the selected objects as well.
useEventListener(
  window,
  'keydown',
  (e: KeyboardEvent) => {
    const id = selectedId.value
    if (id === null || drag.value || ui.view !== 'editor' || e.ctrlKey || e.metaKey || e.altKey) return
    if (ownsKeyboard(document.activeElement)) return
    if (e.key === 'Escape') {
      selectedId.value = null
      return
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return
    e.preventDefault()
    e.stopImmediatePropagation()
    deleteGuide(id)
  },
  { capture: true },
)

const MENU_ITEMS: readonly MenuItem[] = [{ id: 'delete', label: '刪除參考線', hint: 'Delete' }]
const menu = ref<{ at: Anchor; id: string } | null>(null)

/** The right button over a guide: its own menu, and the guide selected for it. */
function openMenu(e: PointerEvent, guide: PageGuide) {
  selectedId.value = guide.id
  menu.value = { at: { x: e.clientX, y: e.clientY }, id: guide.id }
}

function onMenuPick(item: string) {
  const open = menu.value
  menu.value = null
  if (open && item === 'delete') deleteGuide(open.id)
}

interface GuideDrag {
  /** The guide being moved, or null for one still being pulled out of a ruler. */
  id: string | null
  orientation: PageGuide['orientation']
  position: number
  /** Over a ruler or off the canvas, where letting go takes the guide away. */
  away: boolean
  pointerId: number
  /** Where the drag last read the page, for a pointer over a gap between pieces. */
  region: number
  targets: { x: number[]; y: number[] }
  /** Where the press landed on screen, and whether the pointer has since gone far enough to drag. */
  press: Anchor
  moved: boolean
}
const drag = ref<GuideDrag | null>(null)

/** Which way the guide in hand runs, for the canvas's cursor. */
const dragging = computed(() => drag.value?.orientation ?? null)

function rect(): DOMRect | null {
  return rootRef.value?.getBoundingClientRect() ?? null
}

function onRuler(clientX: number, clientY: number, box: DOMRect): boolean {
  if (clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) return true
  if (!preferences.prefs.rulersShown) return false
  return clientX - box.left < RULER_PX || clientY - box.top < RULER_PX
}

/** The page point under a screen point, through the piece it shows, or null over a gap. */
function pageAt(clientX: number, clientY: number, box: DOMRect, fallback = WHOLE_PAGE): { at: Anchor; region: number } {
  const region = explode.regionAtScreen(clientX, clientY, box) ?? fallback
  return { at: explode.pageAtScreen(clientX, clientY, box, region), region }
}

/** The guide within reach of a screen point, nearest first; none over a ruler or a gap. */
function hitAt(clientX: number, clientY: number): PageGuide | null {
  const box = rect()
  if (!box || onRuler(clientX, clientY, box)) return null
  const region = explode.regionAtScreen(clientX, clientY, box)
  if (region === null) return null
  const at = explode.pageAtScreen(clientX, clientY, box, region)
  const reach = PICK_PX / editor.view.scale
  let best: PageGuide | null = null
  let bestGap = reach
  for (const guide of guides.value) {
    const gap = Math.abs((guide.orientation === 'vertical' ? at.x : at.y) - guide.position)
    if (gap <= bestGap) {
      best = guide
      bestGap = gap
    }
  }
  return best
}

function start(
  e: PointerEvent,
  next: { id: string | null; orientation: PageGuide['orientation']; position: number; moved: boolean },
) {
  const root = rootRef.value
  if (!root || editor.currentPageId === null) return
  root.setPointerCapture(e.pointerId)
  drag.value = {
    ...next,
    away: false,
    pointerId: e.pointerId,
    region: WHOLE_PAGE,
    targets: props.snapLines(),
    press: { x: e.clientX, y: e.clientY },
  }
  follow(e)
  window.addEventListener('keydown', onKey, true)
}

function beginNew(e: PointerEvent, orientation: PageGuide['orientation']) {
  if (e.button !== 0) return
  selectedId.value = null
  start(e, { id: null, orientation, position: 0, moved: true })
}

/** Picks up a guide the canvas found under a press: a click selects it, a drag moves it. */
function beginMove(e: PointerEvent, guide: PageGuide) {
  start(e, { id: guide.id, orientation: guide.orientation, position: guide.position, moved: false })
}

/** The guide runs through the pointer, and takes hold of a target in reach while snapping is on — Ctrl turns it the other way. */
function follow(e: PointerEvent) {
  const d = drag.value
  const box = rect()
  if (!d || !box) return
  const moved = d.moved || Math.hypot(e.clientX - d.press.x, e.clientY - d.press.y) >= DRAG_PX
  if (!moved) return
  const { at, region } = pageAt(e.clientX, e.clientY, box, d.region)
  const raw = d.orientation === 'vertical' ? at.x : at.y
  const free = (e.ctrlKey || e.metaKey) === preferences.prefs.snapping
  const snapped = free
    ? null
    : nearestWithin(raw, d.orientation === 'vertical' ? d.targets.x : d.targets.y, SNAP_PX / editor.view.scale)
  drag.value = { ...d, moved, region, position: snapped ?? raw, away: onRuler(e.clientX, e.clientY, box) }
}

function onDragMove(e: PointerEvent) {
  if (drag.value?.pointerId === e.pointerId) follow(e)
}

function onDragEnd(e: PointerEvent) {
  const d = drag.value
  if (!d || d.pointerId !== e.pointerId) return
  follow(e)
  const last = drag.value ?? d
  finish()
  const page = editor.currentPageId
  if (page === null) return
  if (last.id === null) {
    if (!last.away) editor.cmdAddGuide(page, last.orientation, last.position)
  } else if (!last.moved) selectedId.value = last.id
  else if (last.away) deleteGuide(last.id)
  else {
    editor.cmdMoveGuide(page, last.id, last.position)
    selectedId.value = last.id
  }
}

function finish() {
  const d = drag.value
  drag.value = null
  window.removeEventListener('keydown', onKey, true)
  if (d && rootRef.value?.hasPointerCapture(d.pointerId)) rootRef.value.releasePointerCapture(d.pointerId)
}

function cancelDrag() {
  if (drag.value) finish()
}

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  cancelDrag()
}

onBeforeUnmount(finish)

const GUIDE_COLOUR = 'rgb(0, 190, 255)'
const SMART_COLOUR = 'rgb(255, 0, 170)'
const SELECTED_COLOUR = 'rgb(0, 90, 190)'

/** Sizes a canvas to its box at the device's pixel density; false while it has none. */
function fit(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(canvas.clientWidth * dpr)
  const h = Math.round(canvas.clientHeight * dpr)
  if (w === 0 || h === 0) return null
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
  return canvas.getContext('2d')
}

// The guides, drawn in page pixels through each piece of a split page so a
// guide is cut where the page is and jumps with it.
watchEffect(() => {
  const canvas = guidesRef.value
  const view = editor.view
  void editor.viewContainerSize
  const d = drag.value
  const picked = selectedId.value
  const shown = guides.value
    .filter((g) => g.id !== d?.id)
    .map((g) => ({ ...g, faded: false, selected: g.id === picked }))
  if (d) {
    shown.push({
      id: d.id ?? '',
      orientation: d.orientation,
      position: d.position,
      faded: d.away,
      selected: d.id !== null && d.id === picked,
    })
  }
  const smart = props.held
  if (!canvas) return
  const ctx = fit(canvas)
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (shown.length === 0 && smart.length === 0) return
  const pieces = explode.piecesOf(view)
  paintPieces(ctx, view, pieces, dpr, (pieceView: ViewTransform) => {
    applyViewTransform(ctx, pieceView, dpr)
    ctx.lineWidth = 1 / pieceView.scale
    const far = 1e6
    for (const g of shown) {
      ctx.strokeStyle = g.selected ? SELECTED_COLOUR : GUIDE_COLOUR
      ctx.globalAlpha = g.faded ? 0.35 : 1
      ctx.beginPath()
      if (g.orientation === 'vertical') {
        ctx.moveTo(g.position, -far)
        ctx.lineTo(g.position, far)
      } else {
        ctx.moveTo(-far, g.position)
        ctx.lineTo(far, g.position)
      }
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = SMART_COLOUR
    for (const s of smart) {
      ctx.beginPath()
      ctx.moveTo(s.x1, s.y1)
      ctx.lineTo(s.x2, s.y2)
      ctx.stroke()
    }
  })
})

interface Run {
  /** Where along the ruler it starts and ends, in screen pixels. */
  from: number
  to: number
  /** How far the piece it reads has been pushed along this ruler's axis, in page pixels. */
  by: number
}

/**
 * Stretches of a ruler and the piece each reads. Whole, one run. Split, the
 * ruler reads along the line through the pointer — the middle of the canvas
 * when the pointer is elsewhere — so it breaks over every gap that line
 * crosses and numbers each piece where that piece lies on the page.
 */
function runsOf(across: boolean, length: number, box: DOMRect): Run[] {
  if (!explode.exploded) return [{ from: 0, to: length, by: 0 }]
  const size = editor.viewContainerSize
  const line = props.pointer ? (across ? props.pointer.y : props.pointer.x) : across ? size.h / 2 : size.w / 2
  const runs: (Run & { region: number })[] = []
  let current: (Run & { region: number }) | null = null
  const STEP = 2
  for (let s = 0; s < length; s += STEP) {
    const cx = box.left + (across ? s : line)
    const cy = box.top + (across ? line : s)
    const region = explode.regionAtScreen(cx, cy, box)
    if (region === null) {
      current = null
      continue
    }
    if (current && current.region === region) {
      current.to = s + STEP
      continue
    }
    const offset = explode.offsetOf(region)
    current = { from: s, to: s + STEP, by: across ? offset.x : offset.y, region }
    runs.push(current)
  }
  return runs
}

function css(name: string): string {
  return getComputedStyle(rootRef.value ?? document.documentElement).getPropertyValue(name).trim()
}

function drawRuler(canvas: HTMLCanvasElement, across: boolean, level: ViewTransform, box: DOMRect) {
  const ctx = fit(canvas)
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const length = across ? canvas.clientWidth : canvas.clientHeight
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = css('--card')
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight)
  ctx.strokeStyle = css('--border')
  ctx.lineWidth = 1
  ctx.beginPath()
  if (across) {
    ctx.moveTo(0, RULER_PX - 0.5)
    ctx.lineTo(length, RULER_PX - 0.5)
  } else {
    ctx.moveTo(RULER_PX - 0.5, 0)
    ctx.lineTo(RULER_PX - 0.5, length)
  }
  ctx.stroke()

  const { minor } = rulerSteps(level.scale)
  const zero = across ? level.tx : level.ty
  const ink = css('--muted-foreground')
  ctx.strokeStyle = ink
  ctx.fillStyle = ink
  ctx.font = '9px system-ui, sans-serif'
  ctx.textBaseline = 'top'
  for (const run of runsOf(across, length, box)) {
    const first = Math.ceil(((run.from - zero) / level.scale - run.by) / minor)
    const last = Math.floor(((run.to - zero) / level.scale - run.by) / minor)
    for (let k = first; k <= last; k++) {
      const value = k * minor
      const at = Math.round(zero + (value + run.by) * level.scale) + 0.5
      const major = k % 10 === 0
      const tick = major ? RULER_PX : k % 5 === 0 ? 7 : 4
      ctx.beginPath()
      if (across) {
        ctx.moveTo(at, RULER_PX - tick)
        ctx.lineTo(at, RULER_PX)
      } else {
        ctx.moveTo(RULER_PX - tick, at)
        ctx.lineTo(RULER_PX, at)
      }
      ctx.stroke()
      if (!major) continue
      const label = String(Math.round(value))
      if (across) ctx.fillText(label, at + 2, 1)
      else {
        ctx.save()
        ctx.translate(1, at - 2)
        ctx.rotate(-Math.PI / 2)
        ctx.fillText(label, 0, 0)
        ctx.restore()
      }
    }
  }
}

// The rulers move with zooming and panning only: they measure the view turned
// back upright, so turning the page leaves them as they were.
watchEffect(() => {
  const top = topRef.value
  const left = leftRef.value
  const size = editor.viewContainerSize
  const level = levelView(editor.view, size)
  void props.pointer
  void explode.exploded
  void explode.factor
  void preferences.prefs.rulersShown
  const box = rect()
  if (!top || !left || !box) return
  drawRuler(top, true, level, box)
  drawRuler(left, false, level, box)
})

defineExpose({ hitAt, beginMove, openMenu, clearSelection, dragging })
</script>
