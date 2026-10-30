<template>
  <div
    ref="boxEl"
    class="absolute"
    :class="[locked ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab']"
    :style="boxStyle"
    :title="title || undefined"
    @pointerenter="entered = true"
    @pointerleave="entered = false"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @dblclick.stop="onDoubleClick"
  >
    <slot :counter-turn="-turn" :hovered="hovered" />

    <template v-if="handles && selected && !locked">
      <!--
        A band all the way round the outside, under the handles: a press on a
        handle scales, a press a little further out turns. No mode to enter
        first — the selected object is always ready to be turned.
      -->
      <div
        v-for="zone in TURN_ZONES"
        :key="`turn-${zone.key}`"
        class="absolute"
        :style="turnZoneStyle(zone)"
        data-frame-handle
        @pointerdown="ownPress($event) && onRotateDown($event)"
        @dblclick.stop
        @pointermove="onRotateMove"
        @pointerup="onRotateUp"
        @pointercancel="onRotateUp"
      />

      <div
        v-for="corner in CORNERS"
        :key="corner.key"
        class="absolute border border-primary bg-background"
        :class="corner.cursor"
        :style="cornerStyle(corner)"
        data-frame-handle
        @pointerdown="ownPress($event) && onScaleDown($event, corner)"
        @pointermove="onScaleMove"
        @pointerup="onScaleUp"
        @pointercancel="onScaleUp"
      />

      <template v-if="perAxis">
        <div
          v-for="edge in EDGES"
          :key="edge.key"
          class="absolute border border-primary bg-background"
          :class="edge.cursor"
          :style="cornerStyle(edge)"
          data-frame-handle
          @pointerdown="ownPress($event) && onScaleDown($event, edge)"
          @pointermove="onScaleMove"
          @pointerup="onScaleUp"
          @pointercancel="onScaleUp"
        />
      </template>

      <div
        class="absolute flex cursor-move items-center justify-center"
        :style="referenceStyle"
        data-frame-handle
        @pointerdown="ownPress($event) && onReferenceDown($event)"
        @pointermove="onReferenceMove"
        @pointerup="onReferenceUp"
        @pointercancel="onReferenceUp"
      >
        <div class="pointer-events-none absolute bg-primary" :style="crossVerticalStyle" />
        <div class="pointer-events-none absolute bg-primary" :style="crossHorizontalStyle" />
        <div
          class="pointer-events-none absolute rounded-full border border-primary bg-background"
          :style="dotStyle"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useTemplateRef, watch } from 'vue'
import {
  screenToContentPx,
  travelSinceGrab,
  turnedAround,
  type Anchor,
  type Displacement,
  type ViewTransform,
} from '@/lib/coords'
import { angleAround, angleDelta, axisScaleRatio, uniformScaleRatio, type Point } from '@/lib/labelBox'
import { rotateCursor } from '@/lib/rotateCursor'
import { useViewportOrigin } from '@/composables/useCanvasStage'

/**
 * The frame around one object: what says there is something here, and — for the
 * objects whose shape is their rectangle — what takes the pointer for it.
 *
 * It knows a box on screen and nothing else. Where that box came from — a point
 * on the page and a size the typesetter derived, or the extent of a PNG — is the
 * caller's arithmetic, and so is what a gesture means once it has been made.
 * What is shared between the node kinds is
 * not a coordinate system but the question: where is this box, and what happens
 * when its handles are pushed.
 *
 * Every gesture reports and never writes. A drag gives how far the page point
 * it grabbed has travelled, a handle gives a ratio, the band just outside the
 * frame gives an angle; each caller turns those into its own units.
 *
 * All of them are measured on the page rather than on the screen, so a view
 * that zooms, pans or turns mid-gesture leaves what is held exactly where it
 * was. Measured on the screen, a gesture in progress is arithmetic over a ruler
 * that is still changing length.
 */
const props = defineProps<{
  /**
   * Where this node stands, in page pixels — the stage carries the view, so
   * nothing here multiplies by it.
   */
  box: { centerX: number; centerY: number; width: number; height: number }
  /**
   * The view the stage is carrying, which is what puts a pointer on the page —
   * the one thing a gesture has to speak in if it is to survive the view moving
   * under it.
   */
  view: ViewTransform
  /** The object's turn on the page, in radians. */
  rotation: number
  /**
   * Wearing handles: the cursor when it stands alone, or the box round a
   * multiple selection. Never both, so no two sets cover each other.
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
  /**
   * A colour for the outline, or nothing to leave it drawing in `primary`.
   *
   * Which state a frame is in is told by its thickness and by nothing else, so
   * colour was a channel standing empty — which is what lets an object say what
   * it means here without taking the signal that says it is selected.
   *
   * ⚠️ The cost is that being selected is now told by one pixel of thickness
   * alone, and one pixel is harder to compare once no two frames share a colour.
   */
  accent?: string
  /**
   * Keep the outline drawn whether or not the pointer is here — for an object
   * that would otherwise be findable only by hunting for it.
   */
  standing?: boolean
  /**
   * What this frame takes the pointer for.
   *
   * `box` is the whole of it: a press anywhere inside is a press on the object,
   * which is what a text object wants, since its shape is full of holes and an
   * empty one has no pixels at all.
   *
   * `handles` leaves the box itself transparent, so the canvas can work out
   * what was pressed from the pixels rather than from whose rectangle is on
   * top. The handles still answer: only the one selected object wears them, so
   * no two sets can cover each other.
   *
   * `none` while a canvas gesture owns the pointer — panning, or a tool whose
   * drag draws rather than grabs.
   */
  pointer: 'box' | 'handles' | 'none'
  /**
   * The pointer is on this object, worked out by whoever is hit-testing the
   * page. A frame that has given up the pointer cannot notice on its own, and
   * a highlight that disagreed with what a press would take is the one thing
   * hit testing must not produce.
   */
  pointed?: boolean
  title?: string
  /**
   * Whether this frame can scale each axis on its own: side handles, and Shift
   * on a corner. Only for a frame whose owner answers `scaleAxes`; any other
   * would stop following the hand.
   */
  perAxis?: boolean
}>()

const emit = defineEmits<{
  /** Shift held, so the object joins the selection instead of replacing it. */
  select: [additive: boolean]
  /** On press, so a caller can take down where the object was before any write. */
  dragStart: []
  /**
   * How far the page point pressed on has travelled, in page pixels, on every
   * frame past the threshold — and on every view change, since moving the view
   * under a held pointer moves that point too.
   */
  drag: [d: Displacement]
  /** Once on release, and only if the pointer actually travelled. */
  dragEnd: [d: Displacement]
  /**
   * Once a handle's drag turns out to be a drag, so the undo entry has a before.
   * Carries which fractional point of the frame the drag is pinning: the handle
   * across from the one taken hold of, or the reference point under Alt.
   */
  scaleStart: [pin: Point]
  scale: [ratio: number]
  /**
   * A side handle, or Shift on a corner, read as one ratio per frame axis. A
   * separate event because the two mean different things to whoever receives
   * them: one is how much bigger, the other is how much wider and how much
   * taller, and a caller that could only answer the first must not be handed
   * the second.
   */
  scaleAxes: [ratio: Point]
  scaleEnd: []
  /**
   * A double click, carrying where in the frame it landed as a fraction of it —
   * the same currency the pin and the pivot are in. Which is the only thing this
   * frame can say about a point: what the fraction means is the caller's, and
   * for a text object it means a character.
   */
  dblclick: [at: Point]
  /** Likewise, carrying the fractional point the turn is going round. */
  rotateStart: [pivot: Point]
  rotate: [radians: number]
  rotateEnd: [from: number, to: number]
}>()

/**
 * Under this the gesture was a click. Without a threshold an object would creep
 * by a pixel every time it was selected, and the move would land in the undo
 * stack as if it had been asked for.
 */
const DRAG_THRESHOLD_PX = 3

/** The pointer is inside this frame, which only a frame taking it can tell. */
const entered = ref(false)
const boxEl = useTemplateRef<HTMLElement>('boxEl')

const hovered = computed(() => entered.value || props.pointed === true)

const handlePointer = computed<'none' | 'auto'>(() =>
  props.pointer === 'none' ? 'none' : 'auto',
)

/**
 * Held through a drag, because the pointer can outrun the frame and leave it.
 * A selected object wears a heavier line than one merely under the pointer:
 * hovering says something is here, selection says this is what a key will act on.
 */
/**
 * How heavy the outline is, in screen pixels. Nothing means no outline at all.
 *
 * Two states and one channel: hovering says something is here, being in the
 * selection says this is what a key will act on. Colour is left to say what the
 * object means, which is the whole reason it was free to take.
 */
const outlineWidth = computed(() => {
  if (props.selected || props.inSelection) return 2
  if (hovered.value || dragging.value || props.standing) return 1
  return 0
})

/**
 * How the frame lies on screen — the view's turn and the object's.
 *
 * ⚠️ Not what the element is turned by. The stage already carries the view's
 * turn, so the element wears the object's alone; this is for the arithmetic
 * that speaks in client coordinates, where both turns are in force.
 */
const turn = computed(() => props.view.rotate + props.rotation)

/**
 * The outline is written out here rather than composed from utility classes.
 * Its colour comes from the project and its width from this component's own
 * state, so half of it could never have been a class anyway — and a rule split
 * between a stylesheet and an inline value is a rule with two places to be
 * wrong.
 *
 * Its width is in `--px` — screen pixels — because an outline is a mark on the
 * interface rather than a part of the document, and one that thinned away as
 * the page was zoomed out would stop saying anything.
 */
const boxStyle = computed(() => ({
  left: `${props.box.centerX}px`,
  top: `${props.box.centerY}px`,
  width: `${props.box.width}px`,
  height: `${props.box.height}px`,
  transform: `translate(-50%, -50%) rotate(${props.rotation}rad)`,
  // Always solid; a width of zero is what makes it absent, so there is one
  // number deciding whether the outline is there and how heavy it is.
  outlineStyle: 'solid' as const,
  outlineWidth: `calc(${outlineWidth.value}px * var(--px))`,
  // An object no registered tag speaks for draws in the ordinary colour, which
  // is what "nobody has said what this is" looks like.
  outlineColor: props.accent ?? 'var(--primary)',
  pointerEvents: props.pointer === 'box' ? ('auto' as const) : ('none' as const),
  // The object in hand answers before its neighbours, handles and box alike:
  // objects set close together overlap, and a press meant for the one being
  // worked on must not land on the frame of the one beside it.
  zIndex: props.selected ? 1 : undefined,
}))

interface Corner {
  key: string
  kx: 0 | 0.5 | 1
  ky: 0 | 0.5 | 1
  cursor: string
}

const CORNERS: Corner[] = [
  { key: 'tl', kx: 0, ky: 0, cursor: 'cursor-nwse-resize' },
  { key: 'tr', kx: 1, ky: 0, cursor: 'cursor-nesw-resize' },
  { key: 'br', kx: 1, ky: 1, cursor: 'cursor-nwse-resize' },
  { key: 'bl', kx: 0, ky: 1, cursor: 'cursor-nesw-resize' },
]

/**
 * The middles of the four sides, for a frame that scales each axis on its own.
 * A side only has one axis to pull along, so it stretches that one and leaves
 * the other alone — Illustrator's and Figma's side handles, and Photoshop's
 * before 2019 — with no modifier to hold.
 */
const EDGES: Corner[] = [
  { key: 't', kx: 0.5, ky: 0, cursor: 'cursor-ns-resize' },
  { key: 'r', kx: 1, ky: 0.5, cursor: 'cursor-ew-resize' },
  { key: 'b', kx: 0.5, ky: 1, cursor: 'cursor-ns-resize' },
  { key: 'l', kx: 0, ky: 0.5, cursor: 'cursor-ew-resize' },
]

/** Which axes a handle pulls along: a side, one; a corner, both. */
function axesOf(handle: Corner): { x: boolean; y: boolean } {
  return { x: handle.kx !== 0.5, y: handle.ky !== 0.5 }
}

/**
 * How far out from the frame a press turns the object instead of missing it,
 * in screen pixels. Constant on screen so it stays reachable at any zoom.
 */
const TURN_ZONE_PX = 18

function cornerStyle(corner: Corner) {
  return {
    left: `${corner.kx * 100}%`,
    top: `${corner.ky * 100}%`,
    width: `calc(8px * var(--px))`,
    height: `calc(8px * var(--px))`,
    borderWidth: 'calc(1px * var(--px))',
    transform: 'translate(-50%, -50%)',
    pointerEvents: handlePointer.value,
  }
}

/**
 * Photoshop turns from anywhere just outside the box, not only past a corner:
 * four squares off the corners and four strips along the sides between them.
 */
const TURN_ZONES: Corner[] = [...CORNERS, ...EDGES]

/**
 * One piece of the band, laid against the outside of the frame: a corner's
 * square diagonally out from it, a side's strip as long as the side. Turned
 * with the frame, so the band follows the object however it is lying, and the
 * cursor bows away from the part of the frame it hangs off.
 */
function turnZoneStyle(zone: Corner) {
  const along = (k: number) => (k === 0.5 ? '100%' : `calc(${TURN_ZONE_PX}px * var(--px))`)
  const at = (k: number) => (k === 0.5 ? '0%' : `${k * 100}%`)
  const out = (k: number) => (k === 0 ? '-100%' : '0')
  return {
    left: at(zone.kx),
    top: at(zone.ky),
    width: along(zone.kx),
    height: along(zone.ky),
    transform: `translate(${out(zone.kx)}, ${out(zone.ky)})`,
    cursor: rotateCursor(Math.atan2(zone.ky - 0.5, zone.kx - 0.5) + turn.value),
    pointerEvents: handlePointer.value,
  }
}

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
 * The viewport's corner in client coordinates — the one thing standing between
 * a pointer's client coordinates and the page ones the view speaks.
 *
 * ⚠️ The viewport and not this frame's offset parent, which is now the stage
 * and travels with every pan. And ⚠️ never derived from this frame — its
 * rectangle less the page centre it was given reads true and is a trap: `box`
 * is a prop, already carrying the new view by the time a view change is
 * answered, while the rectangle is the last layout, still carrying the old one.
 * Their difference then holds a whole zoom's worth of travel that never
 * happened.
 */
const stageOrigin = useViewportOrigin()

/** Where a client point sits on the page. What every gesture here measures in. */
function pageAt(clientX: number, clientY: number): Anchor {
  return screenToContentPx(clientX, clientY, stageOrigin(), props.view)
}

/**
 * A fractional point of the frame in client coordinates, walked out from the
 * centre in the frame's own axes — the bounding rectangle cannot say where a
 * corner is once the frame is lying at an angle, but the centre plus a turned
 * offset can.
 */
function pointOnScreen(ratio: Point): Point {
  const c = centerOnScreen()
  const scale = props.view.scale
  const out = turnedAround(
    ORIGIN,
    {
      x: (ratio.x - 0.5) * props.box.width * scale,
      y: (ratio.y - 0.5) * props.box.height * scale,
    },
    turn.value,
  )
  return { x: c.x + out.x, y: c.y + out.y }
}

/**
 * A movement across the page as a fraction of the frame, in the frame's own
 * axes. The frame's page size is its screen size divided by the scale, and only
 * the object's own turn is undone — the view's is already gone by the time a
 * point is on the page.
 */
function pageDeltaToFrame(d: Displacement): Point {
  const { width: w, height: h } = props.box
  if (w <= 0 || h <= 0) return ORIGIN
  const turned = turnedAround(ORIGIN, { x: d.dx, y: d.dy }, -props.rotation)
  return { x: turned.x / w, y: turned.y / h }
}

/** The handle across the frame from this one, which a drag on it pins. */
function opposite(corner: Corner): Point {
  return { x: 1 - corner.kx, y: 1 - corner.ky }
}

const MIDDLE: Point = { x: 0.5, y: 0.5 }
const ORIGIN: Point = { x: 0, y: 0 }

/**
 * The point transforms go around, as a fraction of the frame.
 *
 * A tool's state and not the object's: it is never stored, and it comes back to
 * the middle whenever this frame becomes the one being worked on — which is
 * what stops a reference point set for one edit from silently governing the
 * next. Free to sit outside the frame, since a turn around something off to one
 * side is a thing people ask for.
 */
const reference = ref<Point>(MIDDLE)

watch(
  () => props.selected,
  (now) => {
    if (now) reference.value = MIDDLE
  },
)

/** Its own snap targets: the four corners, the four edge midpoints, the middle. */
const REFERENCE_POINTS: Point[] = [0, 0.5, 1].flatMap((y) =>
  [0, 0.5, 1].map((x) => ({ x, y })),
)

/** How close to one of them counts as on it, in screen pixels. */
const REFERENCE_SNAP_PX = 8

/** Transparent margin around the crosshair, so a 10px target is not a 10px target. */
const REFERENCE_HIT_PX = 20

/**
 * Snapped on both axes at once rather than one at a time: what the frame offers
 * is nine points, and an axis-by-axis snap would also hold a crosshair against
 * an edge it was only passing.
 */
function snapReference(at: Point): Point {
  const scale = props.view.scale
  const near = REFERENCE_POINTS.find(
    (p) =>
      Math.hypot((at.x - p.x) * props.box.width * scale, (at.y - p.y) * props.box.height * scale) <=
      REFERENCE_SNAP_PX,
  )
  return near ?? at
}

/**
 * Placed in the frame's own axes so it rides with the object, then turned back
 * upright in place — a crosshair lying on its side reads as a shape rather than
 * as a mark on a point.
 */
/**
 * The parts a person aims at, all sized in screen pixels through `--px`: a
 * handle that shrank with the page would stop being reachable, which is the one
 * thing a handle cannot do.
 */
const dotStyle = { width: 'calc(10px * var(--px))', height: 'calc(10px * var(--px))', borderWidth: 'calc(1px * var(--px))' }

const crossVerticalStyle = { width: 'calc(1px * var(--px))', height: 'calc(16px * var(--px))' }

const crossHorizontalStyle = { width: 'calc(16px * var(--px))', height: 'calc(1px * var(--px))' }

const referenceStyle = computed(() => ({
  left: `${reference.value.x * 100}%`,
  top: `${reference.value.y * 100}%`,
  width: `calc(${REFERENCE_HIT_PX}px * var(--px))`,
  height: `calc(${REFERENCE_HIT_PX}px * var(--px))`,
  transform: `translate(-50%, -50%) rotate(${-turn.value}rad)`,
  pointerEvents: handlePointer.value,
}))

const moveReference = { grab: ORIGIN as Anchor, at: MIDDLE }
let movingReference = false

function onReferenceDown(e: PointerEvent) {
  if (e.button !== 0) return
  capture(e)
  movingReference = true
  moveReference.grab = pageAt(e.clientX, e.clientY)
  moveReference.at = reference.value
}

function onReferenceMove(e: PointerEvent) {
  if (!movingReference) return
  const d = pageDeltaToFrame(
    travelSinceGrab(moveReference.grab, e.clientX, e.clientY, stageOrigin(), props.view),
  )
  reference.value = snapReference({
    x: moveReference.at.x + d.x,
    y: moveReference.at.y + d.y,
  })
}

function onReferenceUp(e: PointerEvent) {
  if (!movingReference) return
  release(e)
  movingReference = false
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
const drag = {
  /** The press, in client coordinates, which is where the threshold is measured. */
  from: ORIGIN as Point,
  /** The page point the press landed on. The view cannot move it. */
  grab: ORIGIN as Anchor,
  /** Where the pointer was last seen, so a view change can be answered without one. */
  client: ORIGIN as Point,
  latest: { dx: 0, dy: 0 } as Displacement,
}
let dragEngaged = false

/**
 * Whether a press on the frame or one of its handles is the frame's. The right
 * button goes on to the canvas, whose ring of properties acts on the object it
 * was pressed over; every other press stops here.
 */
function ownPress(e: PointerEvent): boolean {
  if (e.button === 2) return false
  e.stopPropagation()
  return true
}

function onDown(e: PointerEvent) {
  if (!ownPress(e) || e.button !== 0) return
  capture(e)
  dragging.value = true
  dragEngaged = false
  drag.from = { x: e.clientX, y: e.clientY }
  drag.client = drag.from
  drag.grab = pageAt(e.clientX, e.clientY)
  drag.latest = { dx: 0, dy: 0 }
  emit('select', e.shiftKey)
  emit('dragStart')
}

function reportDrag() {
  drag.latest = travelSinceGrab(drag.grab, drag.client.x, drag.client.y, stageOrigin(), props.view)
  emit('drag', drag.latest)
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
  drag.client = { x: e.clientX, y: e.clientY }
  reportDrag()
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
 * Where the click landed, walked back out of the frame's turn — the bounding
 * rectangle of a frame lying at an angle says nothing about where its own top
 * left is, but its centre plus an untwisted offset does. No scale is undone
 * because `box` is already in screen pixels.
 */
function onDoubleClick(e: MouseEvent) {
  if (props.box.width <= 0 || props.box.height <= 0) return
  const c = centerOnScreen()
  const scale = props.view.scale
  if (scale <= 0) return
  const out = turnedAround(ORIGIN, { x: e.clientX - c.x, y: e.clientY - c.y }, -turn.value)
  emit('dblclick', {
    x: out.x / (props.box.width * scale) + 0.5,
    y: out.y / (props.box.height * scale) + 0.5,
  })
}

/**
 * Nothing is written until the pointer has actually travelled. A stray click on
 * a corner would otherwise pin a label's own font size at whatever it was
 * inheriting, silently cutting it off from the group it follows.
 */
const scale = {
  corner: CORNERS[0],
  pin: ORIGIN as Point,
  /** The pinned handle's page point, which the ratio is measured out from. */
  pivot: ORIGIN as Anchor,
  /** The press, in client coordinates, for the threshold. */
  from: ORIGIN as Point,
  /** The press on the page, which is the ratio's denominator. */
  grab: ORIGIN as Anchor,
  client: ORIGIN as Point,
  /**
   * Shift as it was last seen. Read every frame, unlike Alt: the pin it would
   * swap is what the drag is measured from, while this only decides which of
   * two readings of the same travel is reported, so it can be taken back
   * mid-drag and leave the object exactly where letting go of it would.
   */
  perAxis: false,
}
let scaling = false
let scaleEngaged = false

function onScaleDown(e: PointerEvent, corner: Corner) {
  if (e.button !== 0) return
  capture(e)
  scaling = true
  scaleEngaged = false
  scale.corner = corner
  scale.from = { x: e.clientX, y: e.clientY }
  scale.client = scale.from
  scale.grab = pageAt(e.clientX, e.clientY)
  emit('select', false)
}

function reportScale() {
  const now = pageAt(scale.client.x, scale.client.y)
  const axes = axesOf(scale.corner)
  if (!axes.x || !axes.y) {
    const ratio = axisScaleRatio(scale.pivot, scale.grab, now, props.rotation)
    emit('scaleAxes', { x: axes.x ? ratio.x : 1, y: axes.y ? ratio.y : 1 })
    return
  }
  if (scale.perAxis) emit('scaleAxes', axisScaleRatio(scale.pivot, scale.grab, now, props.rotation))
  else emit('scale', uniformScaleRatio(scale.pivot, scale.grab, now))
}

/**
 * Alt is read once, where the gesture settles on what it is holding still.
 * Reading it every frame would swap the pin under a drag already in progress
 * and jump the object across the page.
 */
function onScaleMove(e: PointerEvent) {
  if (!scaling) return
  if (!scaleEngaged) {
    if (!travelled(e, scale.from)) return
    scaleEngaged = true
    scale.pin = e.altKey ? reference.value : opposite(scale.corner)
    const held = pointOnScreen(scale.pin)
    scale.pivot = pageAt(held.x, held.y)
    emit('scaleStart', scale.pin)
  }
  scale.client = { x: e.clientX, y: e.clientY }
  scale.perAxis = props.perAxis === true && e.shiftKey
  reportScale()
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
  /** The reference point on the page, which is what the turn goes round. */
  center: ORIGIN as Anchor,
  from: ORIGIN as Point,
  client: ORIGIN as Point,
  /** Shift as it was last seen, so a view change turns by the same rule. */
  snapping: false,
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
  const around = pointOnScreen(reference.value)
  spin.center = pageAt(around.x, around.y)
  spin.from = { x: e.clientX, y: e.clientY }
  spin.client = spin.from
  spin.lastAngle = angleAround(spin.center, pageAt(e.clientX, e.clientY))
  spin.start = props.rotation
  spin.free = props.rotation
  spin.applied = props.rotation
  emit('select', false)
}

/**
 * Read on the page, where an angle means what the object's own rotation means.
 * A view turned since the handle was taken hold of would otherwise keep adding
 * its own turn to the object's.
 */
function reportSpin() {
  const now = angleAround(spin.center, pageAt(spin.client.x, spin.client.y))
  // Accumulated rather than measured against the start, so a turn can pass half
  // a revolution and keep going.
  spin.free += angleDelta(spin.lastAngle, now)
  spin.lastAngle = now
  spin.applied = spin.snapping ? Math.round(spin.free / ROTATE_SNAP) * ROTATE_SNAP : spin.free
  emit('rotate', spin.applied)
}

function onRotateMove(e: PointerEvent) {
  if (!spinning) return
  if (!spinEngaged) {
    if (!travelled(e, spin.from)) return
    spinEngaged = true
    emit('rotateStart', reference.value)
  }
  spin.client = { x: e.clientX, y: e.clientY }
  spin.snapping = e.shiftKey
  reportSpin()
}

function onRotateUp(e: PointerEvent) {
  if (!spinning) return
  release(e)
  spinning = false
  if (spinEngaged) emit('rotateEnd', spin.start, spin.applied)
  spinEngaged = false
}

/**
 * A gesture in progress is a standing answer to "where is the held point now",
 * and the view moving is as much a change to that answer as the pointer moving
 * — but nothing sends an event to say so. Without this the object would sit
 * still through a pan and then cross the gap in one step at the next twitch of
 * the mouse.
 */
watch(
  () => [props.view.scale, props.view.tx, props.view.ty, props.view.rotate],
  () => {
    if (dragEngaged) reportDrag()
    if (scaleEngaged) reportScale()
    if (spinEngaged) reportSpin()
  },
)
</script>
