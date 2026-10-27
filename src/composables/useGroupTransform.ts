import { computed, ref, watch } from 'vue'
import { clamp, positionHolding } from '@/lib/coords'
import { carried, groupBox, groupPoint, type MemberFrame } from '@/lib/groupTransform'
import {
  frameCenter,
  layoutOrigin,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  type Point,
} from '@/lib/labelBox'
import { drawnLabel } from '@/lib/labelRaster'
import { type PlacedLabel, useEditorStore } from '@/stores/editorStore'
import { useProjectStore } from '@/stores/projectStore'

const MIDDLE: Point = { x: 0.5, y: 0.5 }

/**
 * A multiple selection on the page as one thing to move, scale and turn — the
 * box Photoshop draws round several layers, with no mode to enter first.
 *
 * The selection is a state, not an object, so nothing about the box is stored:
 * it is worked out from the members every time, lying at however far the set
 * has been turned since it was made. A gesture carries each member's centre
 * round the pivot and turns or scales the member in place by the same amount,
 * which together are exactly the set moving as one; the release is one step.
 */
export function useGroupTransform(options: {
  pageId: () => string | null
  /** The members on this page that a gesture may carry, two or more or none. */
  ids: () => readonly string[]
  /** What each member draws, which is what its frame is measured from. */
  codeOf: (id: string) => string | null
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
    return { style: { ...style }, x, y, rotation }
  }

  function boxOf(id: string, state: PlacedLabel): { w: number; h: number } | null {
    const page = options.pageId()
    const block = page === null ? undefined : project.blockById(page, id)
    const code = options.codeOf(id)
    if (!block || code === null) return null
    return drawnLabel(code, state.style, block.effects, { x: state.x, y: state.y }, state.rotation).box
  }

  function frameOf(id: string, state: PlacedLabel): MemberFrame | null {
    const box = boxOf(id, state)
    if (!box) return null
    const at = { x: state.x, y: state.y }
    return {
      center: frameCenter(at, box, layoutOrigin(state.style), state.rotation),
      w: box.w,
      h: box.h,
      rotation: state.rotation,
    }
  }

  const box = computed(() => {
    const frames: MemberFrame[] = []
    for (const id of options.ids()) {
      const state = stateOf(id)
      const frame = state && frameOf(id, state)
      if (frame) frames.push(frame)
    }
    return frames.length >= 2 ? groupBox(frames, turn.value) : null
  })

  /** What every member was when the gesture took hold, and where its frame stood. */
  let from: Map<string, { state: PlacedLabel; center: Point }> | null = null
  let pivot: Point = MIDDLE
  let turnFrom = 0

  function snapshot(): Map<string, { state: PlacedLabel; center: Point }> {
    const out = new Map<string, { state: PlacedLabel; center: Point }>()
    for (const id of options.ids()) {
      const state = stateOf(id)
      const frame = state && frameOf(id, state)
      if (state && frame) out.set(id, { state, center: frame.center })
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
    const at = positionHolding(center, size, layoutOrigin(state.style), MIDDLE, state.rotation)
    project.setLabelStyle(page, id, state.style)
    project.rotateLabel(page, id, state.rotation)
    project.moveLabel(page, id, at.x, at.y)
  }

  /**
   * Sizes are rounded for the same reason a single object's are — the
   * rasterizer is keyed on the size it was asked for — and every centre moves
   * by the ratio the pointer asked for, so the set keeps its shape.
   */
  function scaleTo(ratio: number): void {
    const page = options.pageId()
    if (!from || page === null) return
    for (const [id, was] of from) {
      if (editor.isLayerLocked(id)) continue
      const fontSizePx = clamp(
        Math.round(was.state.style.fontSizePx * ratio),
        MIN_FONT_SIZE_PX,
        MAX_FONT_SIZE_PX,
      )
      const state = { ...was.state, style: { ...was.state.style, fontSizePx } }
      put(page, id, state, carried(was.center, pivot, 0, ratio))
    }
  }

  /** The angle the frame reports is the set's whole turn; what moves the members is the change. */
  function rotateTo(radians: number): void {
    const page = options.pageId()
    if (!from || page === null) return
    const by = radians - turnFrom
    turn.value = radians
    for (const [id, was] of from) {
      if (editor.isLayerLocked(id)) continue
      const state = { ...was.state, rotation: was.state.rotation + by }
      put(page, id, state, carried(was.center, pivot, by, 1))
    }
  }

  /**
   * A drag on any member reports where that member should stand, and every
   * other one goes the same way. The first report is what takes the before,
   * since nothing has been written by then.
   */
  function moveWith(anchorId: string, to: Point): void {
    const page = options.pageId()
    if (page === null) return
    if (!from) from = snapshot()
    const held = from.get(anchorId)
    if (!held) return
    const dx = to.x - held.state.x
    const dy = to.y - held.state.y
    for (const [id, was] of from) {
      if (editor.isLayerLocked(id)) continue
      project.moveLabel(page, id, was.state.x + dx, was.state.y + dy)
    }
  }

  function end(): void {
    const page = options.pageId()
    const was = from
    from = null
    if (!was || page === null) return
    const before = new Map<string, PlacedLabel>()
    const after = new Map<string, PlacedLabel>()
    for (const [id, held] of was) {
      const now = stateOf(id)
      if (!now) continue
      before.set(id, held.state)
      after.set(id, now)
    }
    editor.cmdPlaceLabels(page, before, after)
  }

  return { box, turn, begin, scaleTo, rotateTo, moveWith, end }
}
