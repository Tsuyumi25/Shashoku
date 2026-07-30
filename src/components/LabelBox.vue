<template>
  <div
    ref="boxEl"
    class="absolute"
    :class="[
      frameClass,
      locked ? 'cursor-default' : drag.dragging.value ? 'cursor-grabbing' : 'cursor-grab',
    ]"
    :style="boxStyle"
    :title="failure || undefined"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @pointerdown.stop="drag.onPointerDown"
    @pointermove="onBoxMove"
    @pointerup="drag.onPointerUp"
    @pointercancel="drag.onPointerUp"
  >
    <div
      class="absolute flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white shadow-md ring-1 ring-black/40 select-none"
      :style="markerStyle"
    >
      {{ index }}
    </div>

    <template v-if="selected && !locked">
      <div
        v-for="corner in CORNERS"
        :key="corner.key"
        class="absolute h-2 w-2 border border-primary bg-background"
        :class="corner.cursor"
        :style="cornerStyle(corner)"
        @pointerdown.stop="onScaleDown"
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
import type { TextStyle } from '@shared/text-style/types'
import { DRAG_THRESHOLD_PX, useLabelDrag, type Anchor } from '@/composables/useLabelDrag'
import { centeredBoxOnScreen, clamp, percentToContentPx, type ViewTransform } from '@/lib/coords'
import {
  angleAround,
  angleDelta,
  labelBoxSize,
  uniformScaleRatio,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  type Point,
} from '@/lib/labelBox'
import { rasterFor } from '@/lib/labelRaster'

/**
 * The frame around one object: what says there is something here, and the only
 * thing on the canvas that takes a pointer.
 *
 * Hit testing lives here rather than on the text because the text is a bitmap
 * with holes in it and an empty label has no bitmap at all — the frame is the
 * one shape every object has, so it is what gets grabbed, and what makes an
 * empty label reachable instead of invisible.
 */
const props = defineProps<{
  index: number
  text: string
  /** Already resolved down the default → group → override chain. */
  textStyle: TextStyle
  /** Label anchor, as a fraction of the raw image. */
  x: number
  y: number
  /** The object's own turn on the page, in radians. */
  rotation: number
  /** The label group's colour, worn by the number badge. */
  color: string
  natural: { w: number; h: number }
  view: ViewTransform
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
}>()

const emit = defineEmits<{
  /** Shift held, so the object joins the selection instead of replacing it. */
  select: [additive: boolean]
  move: [to: Anchor]
  moveEnd: [from: Anchor, to: Anchor]
  /** Once a corner drag turns out to be a drag, so the undo entry has a before. */
  scaleStart: []
  scale: [fontSizePx: number]
  scaleEnd: []
  rotate: [radians: number]
  rotateEnd: [from: number, to: number]
}>()

const drag = useLabelDrag({
  anchor: () => ({ x: props.x, y: props.y }),
  natural: () => props.natural,
  view: () => props.view,
  onSelect: (additive) => emit('select', additive),
  onMove: (to) => emit('move', to),
  onCommit: (from, to) => emit('moveEnd', from, to),
})

/**
 * The press still lands, so a locked object can be selected and its lock
 * reached; only the travel is dropped. Letting the move through and relying on
 * the command to refuse it would not do — the drag writes to the page directly
 * so the canvas keeps up, and only the release goes through a command.
 */
function onBoxMove(e: PointerEvent) {
  if (props.locked) return
  drag.onPointerMove(e)
}

const hovered = ref(false)
const boxEl = useTemplateRef<HTMLElement>('boxEl')

const raster = computed(() => rasterFor(props.text, props.textStyle))
const failure = computed(() => (raster.value.ok ? '' : raster.value.reason))

const box = computed(() => {
  const anchor = percentToContentPx(props.x, props.y, props.natural.w, props.natural.h)
  const size = labelBoxSize(props.textStyle, raster.value.ok ? raster.value.sample.image : null)
  return centeredBoxOnScreen(anchor, size, props.view)
})

/**
 * Held through a drag, because the pointer can outrun the frame and leave it.
 * A selected object wears a heavier line than one merely under the pointer:
 * hovering says something is here, selection says this is what a key will act on.
 */
const frameClass = computed(() => {
  if (props.selected || props.inSelection) return 'outline-2 outline-primary'
  if (hovered.value || drag.dragging.value) return 'outline-1 outline-primary'
  return ''
})

const turn = computed(() => props.view.rotate + props.rotation)

const boxStyle = computed(() => ({
  left: `${box.value.centerX}px`,
  top: `${box.value.centerY}px`,
  width: `${box.value.width}px`,
  height: `${box.value.height}px`,
  transform: `translate(-50%, -50%) rotate(${turn.value}rad)`,
}))

/**
 * How far outside the top left corner the number sits, on each axis. Out along
 * the diagonal rather than straight out to the side: the diagonal buys the same
 * clearance from that corner's scale handle for less distance from the object,
 * and on a wide frame a badge level with the top edge reads as floating beside
 * the object rather than belonging to that corner. Sharing the corner with the
 * handle is not an option — the handle would take the digit's clicks and start
 * a resize.
 */
const MARKER_CORNER_OFFSET_PX = 16

/**
 * Placed off the frame's corner rather than on the anchor, which is where a
 * numbered badge stops covering the text it belongs to. The offset is applied
 * in the frame's own axes, so the badge orbits with the page and the object;
 * the turn is then undone in place so the number stays readable however either
 * is lying. No scale is undone because the frame is already sized in screen
 * pixels.
 */
const markerStyle = computed(() => {
  const out = `-50% - ${MARKER_CORNER_OFFSET_PX}px`
  return {
    left: '0px',
    top: '0px',
    transform: `translate(calc(${out}), calc(${out})) rotate(${-turn.value}rad)`,
    backgroundColor: props.color,
  }
})

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
 * way it is lying — which is the one point both gestures below turn around.
 */
function centerOnScreen(): Point {
  const rect = boxEl.value?.getBoundingClientRect()
  if (!rect) return { x: 0, y: 0 }
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
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
 * Nothing is written until the pointer has actually travelled. A stray click on
 * a corner would otherwise pin the label's own font size at whatever it was
 * inheriting, silently cutting it off from the group it follows.
 */
const scale = { center: { x: 0, y: 0 }, from: { x: 0, y: 0 }, startPx: 0 }
let scaling = false
let scaleEngaged = false

function onScaleDown(e: PointerEvent) {
  if (e.button !== 0) return
  capture(e)
  scaling = true
  scaleEngaged = false
  scale.center = centerOnScreen()
  scale.from = { x: e.clientX, y: e.clientY }
  scale.startPx = props.textStyle.fontSizePx
  emit('select', false)
}

function onScaleMove(e: PointerEvent) {
  if (!scaling) return
  const to = { x: e.clientX, y: e.clientY }
  if (!scaleEngaged) {
    if (!travelled(e, scale.from)) return
    scaleEngaged = true
    emit('scaleStart')
  }
  const ratio = uniformScaleRatio(scale.center, scale.from, to)
  // Rounded because the rasterizer is keyed on the size it was asked for, and a
  // drag through a continuum of fractional sizes would evict its own cache on
  // every frame.
  emit('scale', clamp(Math.round(scale.startPx * ratio), MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX))
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
