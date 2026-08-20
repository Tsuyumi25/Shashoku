<template>
  <ObjectFrame
    :box="box"
    :view-rotate="view.rotate"
    :rotation="rotation"
    :selected="selected"
    :in-selection="inSelection"
    :locked="locked"
    :handles="handles ?? true"
    :accent="accent"
    :standing="framed || untyped"
    :pointer="pointer"
    :title="substitution"
    @select="emit('select', $event)"
    @drag-start="onDragStart"
    @drag="onDrag"
    @drag-end="onDragEnd"
    @scale-start="onScaleStart"
    @scale="onScale"
    @scale-end="emit('scaleEnd')"
    @rotate-start="onRotateStart"
    @rotate="onRotate"
    @rotate-end="onRotateEnd"
  >
    <template #default="{ counterTurn, hovered }">
      <div
        v-if="tags.length > 0 && (hovered || inSelection)"
        class="absolute flex flex-col gap-px rounded bg-black/70 px-1 py-px text-[10px] leading-tight whitespace-nowrap text-white select-none"
        :style="captionStyle(counterTurn)"
      >
        <span v-for="tag in tags" :key="tag.name" class="flex items-center gap-1">
          <span class="h-1.5 w-1.5 shrink-0 rounded-full" :style="{ backgroundColor: tag.color }" />
          {{ tag.name }}
        </span>
      </div>
    </template>
  </ObjectFrame>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TextStyle } from '@shared/text-style/types'
import ObjectFrame from '@/components/ObjectFrame.vue'
import {
  centeredBoxOnScreen,
  clamp,
  framePoint,
  positionHolding,
  screenDeltaToContentPx,
  turnedAround,
  type Anchor,
  type Displacement,
  type ViewTransform,
} from '@/lib/coords'
import type { TurnedLabel } from '@/stores/editorStore'
import { layoutOrigin, MAX_FONT_SIZE_PX, MIN_FONT_SIZE_PX, type Point } from '@/lib/labelBox'
import { drawnLabel, missingFamilyLabel } from '@/lib/labelRaster'

/**
 * A text object's frame: the shared one, over the arithmetic that is text's own.
 *
 * Its anchor is a point on the page and its size is an output rather than an
 * input — the typesetter decides how big a line of dialogue is — so a corner
 * changes the font size and lets the box follow, which is what makes scaling
 * text lossless. Only the four conversions below are text's; everything about
 * being a frame is in `ObjectFrame`.
 *
 * Hit testing lives on the frame rather than on the text because the text is a
 * bitmap with holes in it and an empty label has no bitmap at all — the frame is
 * the one shape every object has, so it is what gets grabbed, and what makes an
 * empty label reachable instead of invisible.
 */
const props = defineProps<{
  text: string
  /** The object's own complete style. */
  textStyle: TextStyle
  /** Label anchor, in page pixels. */
  x: number
  y: number
  /** The object's own turn on the page, in radians. */
  rotation: number
  /**
   * The colour of whichever registered tag sits highest, worn by the frame.
   * Nothing for an object no registered tag speaks for, which leaves the frame
   * drawing in `primary` — not being coloured is what "nobody has said what
   * this is" looks like.
   */
  accent?: string
  /**
   * Draw the frame whether or not the pointer is here — for a tool whose whole
   * subject is the objects and what runs between them. Reading a page's
   * structure means seeing every object at once, and one that appears under the
   * pointer can only be found by hunting for it.
   */
  framed?: boolean
  /**
   * Whether to offer the corner and rotation handles. Off under a tool that
   * takes no pointer on the objects, since a handle drawn but carrying nothing
   * out is an interface that lies.
   */
  handles?: boolean
  /**
   * Whether the frame answers the pointer at all. A text object's shape is its
   * rectangle — the glyphs have holes in them and an empty label has nothing
   * drawn at all — so it is the whole box or nothing, never the handles alone.
   */
  pointer: 'box' | 'none'
  /**
   * What the object is, one tag to a line, shown while the pointer is here or
   * while this is in the selection.
   *
   * Every member of the selection and not only the cursor: a selection is a set
   * of objects being asked about together, and answering for one of them is not
   * an answer. ⚠️ The cost lands on a batch pass over the whole chapter, where
   * every object caught wears its own caption at once.
   *
   * It comes and goes with the frame's own outline rather than waiting out a
   * dwell: the outline is the signal that says the pointer found something, and
   * a caption that arrives after it reads as the interface lagging.
   *
   * One line each rather than a row that truncates: three tags or one long name
   * is not an unusual object, and a name cut off mid-word says less than no
   * name at all. It is the frame colours that a page is read at a glance from;
   * this is for reading one object properly, which is why it is never on more
   * than the two objects the hand is pointing at.
   */
  tags: { name: string; color: string }[]
  natural: { w: number; h: number }
  view: ViewTransform
  selected: boolean
  inSelection: boolean
  locked: boolean
}>()

const emit = defineEmits<{
  select: [additive: boolean]
  move: [to: Anchor]
  moveEnd: [from: Anchor, to: Anchor]
  scaleStart: []
  scale: [fontSizePx: number, at: Anchor]
  scaleEnd: []
  rotate: [radians: number, at: Anchor]
  rotateEnd: [from: TurnedLabel, to: TurnedLabel]
}>()

// Turned, because where the frame's middle sits follows the object round once
// the position names a point other than that middle.
const drawn = computed(() =>
  drawnLabel(props.text, props.textStyle, { x: props.x, y: props.y }, props.rotation),
)

/**
 * What the frame says when the object is showing notdef boxes instead of its
 * text. A state rather than an error — the object is intact and exports as
 * what it is; this machine is the thing that is missing something.
 */
const substitution = computed(() => {
  const missing = drawn.value.missingFamily
  return missing === null ? '' : missingFamilyLabel(missing)
})

// On the drawn centre rather than the stored one, so what is grabbed is where
// the text actually is and the two cannot part company by half a pixel.
const box = computed(() => centeredBoxOnScreen(drawn.value.center, drawn.value.box, props.view))

/**
 * Where the object was before the drag wrote anything. A drag reports total
 * travel rather than a position, so the start has to be kept: reading the
 * anchor again on each frame would compound what has already been applied.
 */
let dragFrom: Anchor = { x: 0, y: 0 }
let dragTo: Anchor = { x: 0, y: 0 }

function onDragStart() {
  dragFrom = { x: props.x, y: props.y }
  dragTo = dragFrom
}

/**
 * A drag writes straight through so the page keeps up with the pointer, and
 * only the release enters the undo stack.
 */
function onDrag(d: Displacement) {
  if (!props.natural.w || !props.natural.h) return
  const delta = screenDeltaToContentPx(d.dx, d.dy, props.view)
  // Clamped to the page: an anchor parked outside it can no longer be reached
  // to be dragged back.
  dragTo = {
    x: clamp(dragFrom.x + delta.x, 0, props.natural.w),
    y: clamp(dragFrom.y + delta.y, 0, props.natural.h),
  }
  emit('move', dragTo)
}

function onDragEnd() {
  emit('moveEnd', dragFrom, dragTo)
}

/**
 * The size the text had when the corner was taken hold of.
 *
 * A corner reports total travel rather than a step, so this has to be the size
 * before the gesture wrote anything. Multiplying the size it has *now* would
 * compound: a ratio climbing to 1.5 over thirty frames would multiply thirty
 * ratios together instead of applying one, and the text would reach its
 * maximum before the pointer had gone anywhere.
 */
let scaleFromPx = 0

/** Which point of the frame the drag is holding still, and where it stands. */
let scalePin: Point = { x: 0, y: 0 }
let scaleHeld: Point = { x: 0, y: 0 }

function onScaleStart(pin: Point) {
  scaleFromPx = props.textStyle.fontSizePx
  scalePin = pin
  scaleHeld = framePoint(
    { x: props.x, y: props.y },
    drawn.value.box,
    layoutOrigin(props.textStyle),
    pin,
    props.rotation,
  )
  emit('scaleStart')
}

/**
 * The size is rounded because the rasterizer is keyed on the size it was asked
 * for, and a drag through a continuum of fractional sizes would evict its own
 * cache on every frame.
 *
 * Where the object then has to stand is worked out from the size the typesetter
 * came back with rather than from the ratio the drag asked for — a clamped or
 * rounded size is not the one the pointer described, and the pinned corner has
 * to hold against what was actually set.
 */
function onScale(ratio: number) {
  const fontSizePx = clamp(Math.round(scaleFromPx * ratio), MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX)
  const style = { ...props.textStyle, fontSizePx }
  const grown = drawnLabel(props.text, style, { x: props.x, y: props.y }, props.rotation)
  emit(
    'scale',
    fontSizePx,
    positionHolding(scaleHeld, grown.box, layoutOrigin(style), scalePin, props.rotation),
  )
}

/**
 * Where the object was lying and standing before the turn, and the page point
 * the turn goes round.
 *
 * A turn about anything but the object's own middle moves it as well as
 * spinning it, so the position has to travel with the angle — and the pivot is
 * taken once, because reading it back from a frame that is already turning
 * would chase its own tail.
 */
let spinFrom: TurnedLabel = { rotation: 0, x: 0, y: 0 }
let spinTo: TurnedLabel = spinFrom
let spinPivot: Anchor = { x: 0, y: 0 }

function onRotateStart(pivot: Point) {
  spinFrom = { rotation: props.rotation, x: props.x, y: props.y }
  spinTo = spinFrom
  spinPivot = framePoint(
    { x: props.x, y: props.y },
    drawn.value.box,
    layoutOrigin(props.textStyle),
    pivot,
    props.rotation,
  )
}

function onRotate(radians: number) {
  const at = turnedAround(spinPivot, spinFrom, radians - spinFrom.rotation)
  spinTo = { rotation: radians, x: at.x, y: at.y }
  emit('rotate', radians, at)
}

function onRotateEnd() {
  emit('rotateEnd', spinFrom, spinTo)
}

/**
 * An object with nothing typed in it yet keeps its frame without being pointed
 * at. Having a frame at all is what makes an empty object reachable, but
 * reachable is not visible — after framing a page of bubbles, the way to check
 * for a missed one has to be looking rather than hunting with the pointer.
 *
 * It clears itself as the work is done: the frames go one by one as the lines
 * are typed, so the clutter only exists while it is the thing being looked for.
 */
const untyped = computed(() => props.text.length === 0)

/**
 * How far outside the top left corner the caption sits, on each axis. Out along
 * the diagonal rather than straight out to the side: the diagonal buys the same
 * clearance from that corner's scale handle for less distance from the object,
 * and on a wide frame something level with the top edge reads as floating
 * beside the object rather than belonging to that corner.
 */
const CAPTION_CORNER_OFFSET_PX = 16

/**
 * Anchored outside the top left corner, growing downward, never flipping to the
 * other side.
 *
 * Growing down is what pins the first line: the tags arrive in the order the
 * project set, so the one that matters most is always in the same place.
 * Centring the block would read better and put that line somewhere new for
 * every object.
 *
 * The offset is applied in the frame's own axes, so the caption orbits with the
 * page and the object; the turn is undone in place so the words stay upright
 * however either is lying. No scale is undone because the frame is already
 * sized in screen pixels. Turned about its own top edge rather than its middle,
 * so where the first line lands does not move as the block grows a line.
 *
 * Nothing here adapts to an edge. An object can stand off the page and still
 * draw, so the page's border is not a wall; the window's is, and a scroll now
 * and then is cheaper than the logic for flipping sides.
 */
function captionStyle(counterTurn: number) {
  return {
    left: '0px',
    top: '0px',
    transform: `translate(calc(-50% - ${CAPTION_CORNER_OFFSET_PX}px), calc(${CAPTION_CORNER_OFFSET_PX}px)) rotate(${counterTurn}rad)`,
    transformOrigin: 'top center',
  }
}
</script>
