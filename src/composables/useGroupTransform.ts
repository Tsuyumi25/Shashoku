import { computed, ref, watch } from 'vue'
import { clamp, positionHolding } from '@/lib/coords'
import { carried, frameCorners, groupBox, groupPoint, stretched, type MemberFrame } from '@/lib/groupTransform'
import { MAX_SCALE_PERCENT, MIN_SCALE_PERCENT } from '@shared/text-style/types'
import {
  frameCenter,
  layoutOrigin,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  type Point,
} from '@/lib/labelBox'
import { drawnLabel } from '@/lib/labelRaster'
import { frameCenter as rasterCenter, placedCorners, type LayerPlacement } from '@/lib/layerTransform'
import type { Rect } from '@/lib/selection/rect'
import type { LayerMove } from '@/composables/useLayerPlacement'
import { type PlacedLabel, useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'
import type { Flip } from '@/lib/flip'

const MIDDLE: Point = { x: 0.5, y: 0.5 }

/** A side dragged past the one across from it stops here rather than turning the set inside out. */
const MIN_RATIO = 0.01

/** The floor on how far a set shrinks, kept on whichever side of the pivot the pointer is. */
function signedFloor(ratio: number): number {
  return (ratio < 0 ? -1 : 1) * Math.max(Math.abs(ratio), MIN_RATIO)
}

function flipOfState(state: PlacedLabel): Flip {
  return { x: state.flipX, y: state.flipY }
}

/** A linear map about the pivot, as canvas's `transform(a, b, c, d)` takes one. */
type Linear = Pick<LayerPlacement, 'a' | 'b' | 'c' | 'd'>

/** What the set's raster layers are moved through: held placements, resampled on release. */
export interface GroupPlacement {
  placementOf(id: string): LayerPlacement
  hold(places: ReadonlyMap<string, LayerPlacement>): void
  take(ids: readonly string[]): ReadonlyMap<string, LayerPlacement>
  settle(pageId: string, taken: ReadonlyMap<string, LayerPlacement>): Promise<LayerMove[]>
  release(taken: ReadonlyMap<string, LayerPlacement>): void
}

/**
 * A multiple selection on the page as one thing to move, scale and turn — the
 * box Photoshop draws round several layers, with no mode to enter first.
 *
 * The selection is a state, not an object, so nothing about the box is stored:
 * it is worked out from the members every time, lying at however far the set
 * has been turned since it was made. A gesture carries each member's centre
 * round the pivot and turns or scales the member in place by the same amount,
 * which together are exactly the set moving as one; the release is one step.
 *
 * Text is written through as the gesture goes, since it is cheap to set again.
 * A raster layer is previewed through a placement and resampled once on
 * release, the way a single layer's gesture is.
 */
export function useGroupTransform(options: {
  pageId: () => string | null
  /** The members on this page that a gesture may carry, two or more or none. */
  ids: () => readonly string[]
  /** What each text member draws, which is what its frame is measured from. */
  codeOf: (id: string) => string | null
  /** Where a raster member's pixels are, or null for a member that is not one. */
  rasterFrame: (id: string) => Rect | null
  placement: GroupPlacement
}) {
  const project = useProjectStore()
  const editor = useEditorStore()

  /** How far the set has been turned since it was made. */
  const turn = ref(0)
  watch(
    () => [...options.ids()].sort().join('\n'),
    () => {
      turn.value = 0
    },
  )

  function stateOf(id: string): PlacedLabel | null {
    const page = options.pageId()
    const block = page === null ? undefined : project.blockById(page, id)
    if (!block) return null
    const { style, x, y, rotation } = block.body
    return { style: { ...style }, x, y, rotation, flipX: block.body.flipX === true, flipY: block.body.flipY === true }
  }

  function boxOf(id: string, state: PlacedLabel): { w: number; h: number } | null {
    const page = options.pageId()
    const block = page === null ? undefined : project.blockById(page, id)
    const code = options.codeOf(id)
    if (!block || code === null) return null
    return drawnLabel(code, state.style, block.effects, { x: state.x, y: state.y }, state.rotation, flipOfState(state)).box
  }

  function frameOf(id: string, state: PlacedLabel): MemberFrame | null {
    const box = boxOf(id, state)
    if (!box) return null
    const at = { x: state.x, y: state.y }
    return {
      center: frameCenter(at, box, layoutOrigin(state.style), state.rotation, flipOfState(state)),
      w: box.w,
      h: box.h,
      rotation: state.rotation,
    }
  }

  function rasterFrameOf(id: string): Rect | null {
    const frame = options.rasterFrame(id)
    return frame !== null && frame.w > 0 && frame.h > 0 ? frame : null
  }

  const box = computed(() => {
    const corners: Point[][] = []
    for (const id of options.ids()) {
      const raster = rasterFrameOf(id)
      if (raster !== null) {
        corners.push(placedCorners(raster, options.placement.placementOf(id)))
        continue
      }
      const state = stateOf(id)
      const frame = state && frameOf(id, state)
      if (frame) corners.push(frameCorners(frame))
    }
    return corners.length >= 2 ? groupBox(corners, turn.value) : null
  })

  /** What every member was when the gesture took hold, and where its frame stood. */
  interface Snapshot {
    labels: Map<string, { state: PlacedLabel; center: Point }>
    rasters: Map<string, Point>
  }
  let from: Snapshot | null = null
  let pivot: Point = MIDDLE
  let turnFrom = 0

  function snapshot(): Snapshot {
    const out: Snapshot = { labels: new Map(), rasters: new Map() }
    for (const id of options.ids()) {
      const raster = rasterFrameOf(id)
      if (raster !== null) {
        out.rasters.set(id, rasterCenter(raster))
        continue
      }
      const state = stateOf(id)
      const frame = state && frameOf(id, state)
      if (state && frame) out.labels.set(id, { state, center: frame.center })
    }
    return out
  }

  /** Before the first write, with the fractional point of the box the gesture holds still. */
  function begin(at: Point): void {
    const now = box.value
    from = snapshot()
    turnFrom = turn.value
    pivot = now ? groupPoint(now, turn.value, at) : MIDDLE
  }

  /** A member written so its frame's middle lands on `center`, whatever size it came out at. */
  function put(page: string, id: string, state: PlacedLabel, center: Point): void {
    const size = boxOf(id, state)
    if (!size) return
    const flip = flipOfState(state)
    const at = positionHolding(center, size, layoutOrigin(state.style), MIDDLE, state.rotation, flip)
    project.setLabelStyle(page, id, state.style)
    project.rotateLabel(page, id, state.rotation)
    project.flipLabel(page, id, flip)
    project.moveLabel(page, id, at.x, at.y)
  }

  /** Every raster member carried through `linear` about the pivot, held in one write. */
  function holdRasters(was: Snapshot, linear: Linear): void {
    const places = new Map<string, LayerPlacement>()
    for (const [id, center] of was.rasters) {
      const ox = center.x - pivot.x
      const oy = center.y - pivot.y
      const to = { x: pivot.x + linear.a * ox + linear.c * oy, y: pivot.y + linear.b * ox + linear.d * oy }
      places.set(id, { ...linear, dx: to.x - center.x, dy: to.y - center.y })
    }
    if (places.size > 0) options.placement.hold(places)
  }

  /**
   * Sizes are rounded for the same reason a single object's are — the
   * rasterizer is keyed on the size it was asked for — and every centre moves
   * by the ratio the pointer asked for, so the set keeps its shape.
   */
  function scaleTo(ratio: number): void {
    const page = options.pageId()
    if (!from || page === null) return
    const s = signedFloor(ratio)
    for (const [id, was] of from.labels) {
      if (editor.isLayerLocked(id)) continue
      const fontSizePx = clamp(Math.round(was.state.style.fontSizePx * Math.abs(s)), MIN_FONT_SIZE_PX, MAX_FONT_SIZE_PX)
      // Past the pivot the set is mirrored on both axes, and so is each member.
      const state = {
        ...was.state,
        style: { ...was.state.style, fontSizePx },
        flipX: was.state.flipX !== s < 0,
        flipY: was.state.flipY !== s < 0,
      }
      put(page, id, state, carried(was.center, pivot, 0, s))
    }
    holdRasters(from, { a: s, b: 0, c: 0, d: s })
  }

  /**
   * A side of the box, or Shift on a corner: the set stretches along the box's
   * own axes. A text member's stretch lands in its own horizontal and vertical
   * scale — the fields a single object's side handles write; a raster member's
   * is resampled as it stands, shear and all.
   */
  function scaleAxesTo(ratio: Point): void {
    const page = options.pageId()
    if (!from || page === null) return
    const r = { x: signedFloor(ratio.x), y: signedFloor(ratio.y) }
    for (const [id, was] of from.labels) {
      if (editor.isLayerLocked(id)) continue
      const s = stretched(was.center, was.state.rotation, pivot, turn.value, r)
      const style = {
        ...was.state.style,
        scaleXPercent: clamp(Math.round(was.state.style.scaleXPercent * s.scaleX), MIN_SCALE_PERCENT, MAX_SCALE_PERCENT),
        scaleYPercent: clamp(Math.round(was.state.style.scaleYPercent * s.scaleY), MIN_SCALE_PERCENT, MAX_SCALE_PERCENT),
      }
      const flipX = was.state.flipX !== s.mirrored
      put(page, id, { ...was.state, style, rotation: s.rotation, flipX }, s.center)
    }
    const cos = Math.cos(turn.value)
    const sin = Math.sin(turn.value)
    const cross = (r.x - r.y) * cos * sin
    holdRasters(from, { a: r.x * cos * cos + r.y * sin * sin, b: cross, c: cross, d: r.x * sin * sin + r.y * cos * cos })
  }

  /** The angle the frame reports is the set's whole turn; what moves the members is the change. */
  function rotateTo(radians: number): void {
    const page = options.pageId()
    if (!from || page === null) return
    const by = radians - turnFrom
    turn.value = radians
    for (const [id, was] of from.labels) {
      if (editor.isLayerLocked(id)) continue
      const state = { ...was.state, rotation: was.state.rotation + by }
      put(page, id, state, carried(was.center, pivot, by, 1))
    }
    const cos = Math.cos(by)
    const sin = Math.sin(by)
    holdRasters(from, { a: cos, b: sin, c: -sin, d: cos })
  }

  /** Every member moved by the same distance from where the gesture took hold. */
  function moveBy(dx: number, dy: number): void {
    const page = options.pageId()
    if (page === null) return
    from ??= snapshot()
    for (const [id, was] of from.labels) {
      if (editor.isLayerLocked(id)) continue
      project.moveLabel(page, id, was.state.x + dx, was.state.y + dy)
    }
    const places = new Map<string, LayerPlacement>()
    for (const id of from.rasters.keys()) places.set(id, { dx, dy, a: 1, b: 0, c: 0, d: 1 })
    if (places.size > 0) options.placement.hold(places)
  }

  /**
   * A drag on a text member reports where that member should stand, and every
   * other one goes the same way. The first report is what takes the before,
   * since nothing has been written by then.
   */
  function moveWith(anchorId: string, to: Point): void {
    from ??= snapshot()
    const held = from.labels.get(anchorId)
    if (!held) return
    moveBy(to.x - held.state.x, to.y - held.state.y)
  }

  /**
   * One step for the whole gesture. The text is already where it was taken;
   * the raster layers are resampled first, and held at their placements until
   * the step has put them there, so nothing snaps back in between.
   */
  async function end(): Promise<void> {
    const page = options.pageId()
    const was = from
    from = null
    if (!was || page === null) return
    const taken = options.placement.take([...was.rasters.keys()])
    try {
      const before = new Map<string, PlacedLabel>()
      const after = new Map<string, PlacedLabel>()
      for (const [id, held] of was.labels) {
        const now = stateOf(id)
        if (!now) continue
        before.set(id, held.state)
        after.set(id, now)
      }
      const layers = await options.placement.settle(page, taken)
      editor.cmdPlaceObjects(page, { labels: { from: before, to: after }, layers })
    } finally {
      options.placement.release(taken)
    }
  }

  return { box, turn, begin, scaleTo, scaleAxesTo, rotateTo, moveBy, moveWith, end }
}
