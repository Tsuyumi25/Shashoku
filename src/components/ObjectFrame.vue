<template>
  <div
    ref="boxEl"
    class="absolute"
    :class="[
      frameClass,
      locked ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab',
    ]"
    :style="boxStyle"
    :title="title || undefined"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @pointerdown.stop="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  >
    <slot :counter-turn="-turn" />

    <template v-if="handles && selected && !locked">
      <div
        v-for="corner in CORNERS"
        :key="corner.key"
        class="absolute h-2 w-2 border border-primary bg-background"
        :class="corner.cursor"
        :style="cornerStyle(corner)"
        @pointerdown.stop="onScaleDown($event, corner)"
        @pointermove="onScaleMove"
        @pointerup="onScaleUp"
        @pointercancel="onScaleUp"
      />

      <div class="pointer-events-none absolute w-px bg-primary" :style="antennaStemStyle" />
      <div
        class="absolute flex cursor-grab items-center justify-center rounded-full"
        :style="antennaHandleStyle"
        @pointerdown.stop="onRotateDown"
        @pointermove="onRotateMove"
        @pointerup="onRotateUp"
        @pointercancel="onRotateUp"
      >
        <div class="h-2.5 w-2.5 rounded-full border border-primary bg-background" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef } from 'vue'
import type { Displacement } from '@/lib/coords'
import { angleAround, angleDelta, uniformScaleRatio, type Point } from '@/lib/labelBox'

/**
 * The frame around one object: what says there is something here, and the only
 * thing on the canvas that takes a pointer.
 *
 * It knows a box on screen and nothing else. Where that box came from — a point
 * on the page and a size the typesetter derived, or the extent of a PNG — is the
 * caller's arithmetic, and so is what a gesture means once it has been made.
 * What is shared between the node kinds is
 * not a coordinate system but the question: where is this box, and what happens
 * when its handles are pushed.
 *
 * Every gesture reports and never writes. A drag gives cumulative screen
 * displacement, a corner gives a ratio, the antenna gives an angle; each caller
 * turns those into its own units.
 */
const props = defineProps<{
  /** Screen placement, already resolved by whoever knows this node's geometry. */
  box: { centerX: number; centerY: number; width: number; height: number }
  /** The view's own turn, in radians. */
  viewRotate: number
  /** The object's turn on the page, in radians. */
  rotation: number
  /**
   * The cursor — the one a single-object command acts on, and the only one
   * wearing handles. Canvas gestures still move one object at a time, so a
   * second set of handles would be offering a drag nothing carries out.
   */
  selected: boolean
  /** In the selection, cursor or not. Outlined, but without handles. */
  inSelection: boolean
  /**
   * Its own lock or a folder's above it. Still selectable — there would be no
   * way to reach the lock otherwise — but it offers no gesture that would move
   * it, so the refusal is visible before the drag rather than after it.
   */
  locked: boolean
  /**
   * Whether this kind of node can be scaled and turned yet. A handle that is
   * drawn but carries nothing out is an interface that lies, and it would be
   * pulled before anything else.
   */
  handles: boolean
  title?: string
}>()

const emit = defineEmits<{
  /** Shift held, so the object joins the selection instead of replacing it. */
  select: [additive: boolean]
  /** On press, so a caller can take down where the object was before any write. */
  dragStart: []
  /** Cumulative screen displacement, on every frame past the threshold. */
  drag: [d: Displacement]
  /** Once on release, and only if the pointer actually travelled. */
  dragEnd: [d: Displacement]
  /**
   * Once a corner drag turns out to be a drag, so the undo entry has a before.
   * Carries which fractional point of the frame the drag is pinning — the
   * handle across from the one taken hold of.
   */
  scaleStart: [pin: Point]
  scale: [ratio: number]
  scaleEnd: []
  rotate: [radians: number]
  rotateEnd: [from: number, to: number]
}>()

/**
 * Under this the gesture was a click. Without a threshold an object would creep
 * by a pixel every time it was selected, and the move would land in the undo
 * stack as if it had been asked for.
 */
const DRAG_THRESHOLD_PX = 3

const hovered = ref(false)
const boxEl = useTemplateRef<HTMLElement>('boxEl')

/**
 * Held through a drag, because the pointer can outrun the frame and leave it.
 * A selected object wears a heavier line than one merely under the pointer:
 * hovering says something is here, selection says this is what a key will act on.
 */
const frameClass = computed(() => {
  if (props.selected || props.inSelection) return 'outline-2 outline-primary'
  if (hovered.value || dragging.value) return 'outline-1 outline-primary'
  return ''
})

const turn = computed(() => props.viewRotate + props.rotation)

const boxStyle = computed(() => ({
  left: `${props.box.centerX}px`,
  top: `${props.box.centerY}px`,
  width: `${props.box.width}px`,
  height: `${props.box.height}px`,
  transform: `translate(-50%, -50%) rotate(${turn.value}rad)`,
}))

interface Corner {
  key: string
  kx: 0 | 1
  ky: 0 | 1
  cursor: string
}

const CORNERS: Corner[] = [
  { key: 'tl', kx: 0, ky: 0, cursor: 'cursor-nwse-resize' },
  { key: 'tr', kx: 1, ky: 0, cursor: 'cursor-nesw-resize' },
  { key: 'br', kx: 1, ky: 1, cursor: 'cursor-nwse-resize' },
  { key: 'bl', kx: 0, ky: 1, cursor: 'cursor-nesw-resize' },
]

/**
 * How far above the frame the rotation handle stands off, in screen pixels.
 * Shorter than the 40 to 50 that general purpose canvas libraries default to,
 * because a line of dialogue is often only a few tens of pixels tall and a stem
 * that long would be taller than the object it belongs to. Constant on screen
 * rather than scaled with the view, so it stays reachable at any zoom.
 */
const ANTENNA_LENGTH_PX = 24

/** Transparent margin around the dot, so a 10px target is not a 10px target. */
const ANTENNA_HANDLE_HIT_PX = 20

function cornerStyle(corner: Corner) {
  return {
    left: `${corner.kx * 100}%`,
    top: `${corner.ky * 100}%`,
    transform: 'translate(-50%, -50%)',
  }
}

/**
 * Both parts hang off the top edge's midpoint and inherit the frame's rotation,
 * which is what points the antenna at the object's own up rather than at the
 * top of the screen — the view's turn is already folded into that rotation, so
 * a page lying on its side takes its objects' handles with it.
 */
const antennaStemStyle = computed(() => ({
  left: '50%',
  top: '0px',
  height: `${ANTENNA_LENGTH_PX}px`,
  transform: 'translate(-50%, -100%)',
}))

const antennaHandleStyle = computed(() => ({
  left: '50%',
  top: '0px',
  width: `${ANTENNA_HANDLE_HIT_PX}px`,
  height: `${ANTENNA_HANDLE_HIT_PX}px`,
  transform: `translate(-50%, calc(-50% - ${ANTENNA_LENGTH_PX}px))`,
}))

/**
 * The frame's centre in client coordinates. A rotated element still reports an
 * upright bounding rectangle, and its centre is the element's centre whichever
 * way it is lying — which is what makes it the one point readable off a
 * rotated element without undoing the rotation first.
 */
function centerOnScreen(): Point {
  const rect = boxEl.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/**
 * A fractional point of the frame in client coordinates, walked out from the
 * centre in the frame's own axes — the bounding rectangle cannot say where a
 * corner is once the frame is lying at an angle, but the centre plus a turned
 * offset can.
 */
function pointOnScreen(ratio: Point): Point {
  const c = centerOnScreen()
  const dx = (ratio.x - 0.5) * props.box.width
  const dy = (ratio.y - 0.5) * props.box.height
  const cos = Math.cos(turn.value)
  const sin = Math.sin(turn.value)
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

/** The handle across the frame from this one, which a drag on it pins. */
function opposite(corner: Corner): Point {
  return { x: 1 - corner.kx, y: 1 - corner.ky }
}

function capture(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}

function release(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
}

function travelled(e: PointerEvent, from: Point): boolean {
  return Math.hypot(e.clientX - from.x, e.clientY - from.y) >= DRAG_THRESHOLD_PX
}

/**
 * The pointer is captured on the element the gesture started on, so a fast drag
 * that outruns the frame keeps moving it.
 */
const dragging = ref(false)
const drag = { from: { x: 0, y: 0 }, latest: { dx: 0, dy: 0 } }
let dragEngaged = false

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  capture(e)
  dragging.value = true
  dragEngaged = false
  drag.from = { x: e.clientX, y: e.clientY }
  drag.latest = { dx: 0, dy: 0 }
  emit('select', e.shiftKey)
  emit('dragStart')
}

/**
 * The press still lands, so a locked object can be selected and its lock
 * reached; only the travel is dropped. Letting the move through and relying on
 * the command to refuse it would not do — a drag writes so the canvas keeps up,
 * and only the release goes through a command.
 */
function onMove(e: PointerEvent) {
  if (!dragging.value || props.locked) return
  if (!dragEngaged) {
    if (!travelled(e, drag.from)) return
    dragEngaged = true
  }
  drag.latest = { dx: e.clientX - drag.from.x, dy: e.clientY - drag.from.y }
  emit('drag', drag.latest)
}

function onUp(e: PointerEvent) {
  if (!dragging.value) return
  release(e)
  dragging.value = false
  // A cancel arrives here too. Keeping where the object was left beats snapping
  // it back, which loses a deliberate move to an interruption.
  if (dragEngaged) emit('dragEnd', drag.latest)
  dragEngaged = false
}

/**
 * Nothing is written until the pointer has actually travelled. A stray click on
 * a corner would otherwise pin a label's own font size at whatever it was
 * inheriting, silently cutting it off from the group it follows.
 */
const scale = { pin: { x: 0, y: 0 }, pivot: { x: 0, y: 0 }, from: { x: 0, y: 0 } }
let scaling = false
let scaleEngaged = false

function onScaleDown(e: PointerEvent, corner: Corner) {
  if (e.button !== 0) return
  capture(e)
  scaling = true
  scaleEngaged = false
  scale.pin = opposite(corner)
  scale.pivot = pointOnScreen(scale.pin)
  scale.from = { x: e.clientX, y: e.clientY }
  emit('select', false)
}

function onScaleMove(e: PointerEvent) {
  if (!scaling) return
  const to = { x: e.clientX, y: e.clientY }
  if (!scaleEngaged) {
    if (!travelled(e, scale.from)) return
    scaleEngaged = true
    emit('scaleStart', scale.pin)
  }
  emit('scale', uniformScaleRatio(scale.pivot, scale.from, to))
}

function onScaleUp(e: PointerEvent) {
  if (!scaling) return
  release(e)
  scaling = false
  if (scaleEngaged) emit('scaleEnd')
  scaleEngaged = false
}

/** 15 degrees, the step the canvas's own rotation gesture snaps to. */
const ROTATE_SNAP = Math.PI / 12

const spin = {
  center: { x: 0, y: 0 },
  from: { x: 0, y: 0 },
  lastAngle: 0,
  /** Where the object was lying when the handle was taken hold of. */
  start: 0,
  /** The wrist's total travel, which snapping reads and never writes back. */
  free: 0,
  applied: 0,
}
let spinning = false
let spinEngaged = false

function onRotateDown(e: PointerEvent) {
  if (e.button !== 0) return
  capture(e)
  spinning = true
  spinEngaged = false
  spin.center = centerOnScreen()
  spin.from = { x: e.clientX, y: e.clientY }
  spin.lastAngle = angleAround(spin.center, spin.from)
  spin.start = props.rotation
  spin.free = props.rotation
  spin.applied = props.rotation
  emit('select', false)
}

function onRotateMove(e: PointerEvent) {
  if (!spinning) return
  if (!spinEngaged) {
    if (!travelled(e, spin.from)) return
    spinEngaged = true
  }
  const now = angleAround(spin.center, { x: e.clientX, y: e.clientY })
  // Accumulated rather than measured against the start, so a turn can pass half
  // a revolution and keep going.
  spin.free += angleDelta(spin.lastAngle, now)
  spin.lastAngle = now
  spin.applied = e.shiftKey ? Math.round(spin.free / ROTATE_SNAP) * ROTATE_SNAP : spin.free
  emit('rotate', spin.applied)
}

function onRotateUp(e: PointerEvent) {
  if (!spinning) return
  release(e)
  spinning = false
  if (spinEngaged) emit('rotateEnd', spin.start, spin.applied)
  spinEngaged = false
}
</script>
