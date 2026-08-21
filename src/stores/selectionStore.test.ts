import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editorStore'
import { useSelectionStore, type MaskTarget } from '@/stores/selectionStore'
import { rasterizeRect } from '@/lib/selection/raster'
import type { SelectionOp } from '@/lib/selection/mask'
import type { Rect } from '@/lib/selection/rect'

const PAGE_A: MaskTarget = { page: 'p001.png', w: 32, h: 32 }
const PAGE_B: MaskTarget = { page: 'p002.png', w: 32, h: 32 }

/**
 * The real engine, not a stand-in.
 *
 * The selection's coverage lives in its tiles now, and a fake here would be a
 * second implementation of the invariants the tiles exist to keep — the one
 * thing a test of this store must not quietly assume. It is the same addon
 * preload hands the renderer, reached the same way, so `pnpm test` needs
 * `pnpm engine:build` to have run.
 */
const engine = createRequire(import.meta.url)('@shashoku/engine') as Window['engine']

type Selection = ReturnType<typeof useSelectionStore>

function select(
  sel: Selection,
  target: MaskTarget,
  rect: Rect,
  op: SelectionOp = 'new',
): void {
  sel.applyShape(target, rasterizeRect(target, rect), op, 'test')
}

function maskAt(sel: Selection, target: MaskTarget, x: number, y: number): number {
  return sel.maskPatchOf(target.page, { x, y, w: 1, h: 1 })?.[0] ?? 0
}

beforeAll(() => {
  vi.stubGlobal('window', { engine })
})

beforeEach(() => {
  // One selection, one global. Every test starts from nothing held.
  engine.maskReset()
  setActivePinia(createPinia())
})

describe('holding one selection', () => {
  it('starts with nothing', () => {
    const sel = useSelectionStore()
    expect(sel.hasSelection).toBe(false)
    expect(sel.bounds).toBeNull()
    expect(sel.heldPage()).not.toBe(PAGE_A.page)
  })

  it('remembers which page it is for', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    expect(sel.bounds).toEqual({ x: 4, y: 4, w: 8, h: 8 })
    expect(sel.heldPage()).toBe(PAGE_A.page)
    // Hidden on another page, not destroyed by looking away from it.
    expect(sel.maskPatchOf(PAGE_B.page, { x: 0, y: 0, w: 1, h: 1 })).toBeNull()
    expect(sel.displayFor(PAGE_B.page)).toBeNull()
    expect(sel.heldPage()).toBe(PAGE_A.page)
  })

  it('is replaced by selecting on another page', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    select(sel, PAGE_B, { x: 0, y: 0, w: 4, h: 4 })
    expect(sel.heldPage()).toBe(PAGE_B.page)
    expect(sel.heldPage()).not.toBe(PAGE_A.page)
  })
})

describe('the boolean operations', () => {
  it('adds, subtracts and intersects', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 8, h: 8 })
    select(sel, PAGE_A, { x: 8, y: 0, w: 8, h: 8 }, 'add')
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 16, h: 8 })

    select(sel, PAGE_A, { x: 0, y: 0, w: 4, h: 8 }, 'subtract')
    expect(sel.bounds).toEqual({ x: 4, y: 0, w: 12, h: 8 })
    expect(maskAt(sel, PAGE_A, 0, 0)).toBe(0)

    select(sel, PAGE_A, { x: 0, y: 0, w: 8, h: 8 }, 'intersect')
    expect(sel.bounds).toEqual({ x: 4, y: 0, w: 4, h: 8 })
  })

  it('reads add and intersect as a plain new selection when nothing is held', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 2, y: 2, w: 4, h: 4 }, 'add')
    expect(sel.bounds).toEqual({ x: 2, y: 2, w: 4, h: 4 })
  })

  it('refuses to subtract from nothing rather than pushing an empty command', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 2, y: 2, w: 4, h: 4 }, 'subtract')
    expect(sel.hasSelection).toBe(false)
    expect(editor.canUndo).toBe(false)
  })

  it('subtracting everything away leaves no selection', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 4, h: 4 })
    select(sel, PAGE_A, { x: 0, y: 0, w: 16, h: 16 }, 'subtract')
    expect(sel.bounds).toBeNull()
    expect(sel.hasSelection).toBe(false)
  })

  /**
   * A mask subtracted down to nothing is a page of zeroes, not a selection, so
   * the next gesture starts fresh and a click on it has nothing to take back.
   */
  it('treats an emptied mask as no selection at all', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 4, h: 4 })
    select(sel, PAGE_A, { x: 0, y: 0, w: 16, h: 16 }, 'subtract')
    const stack = editor.canUndo

    select(sel, PAGE_A, { x: 9, y: 9, w: 0, h: 0 })
    expect(editor.canUndo).toBe(stack)
    editor.undo()
    expect(sel.bounds).toEqual({ x: 4, y: 4, w: 4, h: 4 })
  })

  it('adds onto an emptied mask as though selecting anew', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 4, h: 4 })
    select(sel, PAGE_A, { x: 0, y: 0, w: 16, h: 16 }, 'subtract')
    select(sel, PAGE_A, { x: 20, y: 20, w: 4, h: 4 }, 'add')
    expect(sel.bounds).toEqual({ x: 20, y: 20, w: 4, h: 4 })
  })

  it('takes a click with a marquee as deselecting', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 4, h: 4 })
    select(sel, PAGE_A, { x: 9, y: 9, w: 0, h: 0 })
    expect(sel.hasSelection).toBe(false)
  })

  it('leaves another page alone when a click deselects', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 4, h: 4 })
    select(sel, PAGE_B, { x: 9, y: 9, w: 0, h: 0 })
    expect(sel.heldPage()).toBe(PAGE_A.page)
    expect(sel.hasSelection).toBe(true)
  })
})

describe('select all, invert and deselect', () => {
  it('selects the whole page and inverts back to nothing', () => {
    const sel = useSelectionStore()
    sel.selectAll(PAGE_A)
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 32, h: 32 })
    sel.invert(PAGE_A)
    expect(sel.bounds).toBeNull()
  })

  it('inverting nothing selects everything', () => {
    const sel = useSelectionStore()
    sel.invert(PAGE_A)
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 32, h: 32 })
  })

  it('deselecting is a no-op with nothing selected', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    sel.deselect()
    expect(editor.canUndo).toBe(false)
  })
})

describe('undo', () => {
  it('takes back a selection without dirtying the project', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(sel.hasSelection).toBe(false)
    editor.redo()
    expect(sel.bounds).toEqual({ x: 4, y: 4, w: 8, h: 8 })
  })

  it('walks back through a run of operations one at a time', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 8, h: 8 })
    select(sel, PAGE_A, { x: 8, y: 0, w: 8, h: 8 }, 'add')
    select(sel, PAGE_A, { x: 0, y: 0, w: 4, h: 8 }, 'subtract')

    editor.undo()
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 16, h: 8 })
    editor.undo()
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 8, h: 8 })
    editor.undo()
    expect(sel.hasSelection).toBe(false)
  })

  it('restores a deselect', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    sel.deselect()
    editor.undo()
    expect(sel.bounds).toEqual({ x: 4, y: 4, w: 8, h: 8 })
    expect(maskAt(sel, PAGE_A, 5, 5)).toBe(255)
  })

  it('restores a soft mask byte for byte, feathering and all', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    const soft = rasterizeRect(PAGE_A, { x: 4, y: 4, w: 4, h: 4 })
    soft.coverage.fill(90)
    sel.applyShape(PAGE_A, soft, 'new', 'test')
    expect(maskAt(sel, PAGE_A, 5, 5)).toBe(90)

    select(sel, PAGE_A, { x: 0, y: 0, w: 16, h: 16 })
    editor.undo()
    expect(maskAt(sel, PAGE_A, 5, 5)).toBe(90)
    expect(maskAt(sel, PAGE_A, 1, 1)).toBe(0)
  })

  /**
   * The reason a page-crossing command records the whole outgoing mask: one
   * selection means making one somewhere else destroys the last, and undo has
   * to be able to put back something that is no longer anywhere.
   */
  it('brings back the selection a page change took away', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 8, h: 8 })
    select(sel, PAGE_A, { x: 8, y: 0, w: 8, h: 8 }, 'add')
    select(sel, PAGE_B, { x: 20, y: 20, w: 4, h: 4 })

    editor.undo()
    expect(sel.heldPage()).toBe(PAGE_A.page)
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 16, h: 8 })
    editor.undo()
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 8, h: 8 })
  })

  it('turns to the page the command happened on', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    editor.currentPageId = PAGE_A.page
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    editor.currentPageId = PAGE_B.page

    editor.undo()
    expect(editor.currentPageId).toBe(PAGE_A.page)
    editor.currentPageId = PAGE_B.page
    editor.redo()
    expect(editor.currentPageId).toBe(PAGE_A.page)
  })
})

describe('gestures', () => {
  it('leaves the held mask alone until the release', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    sel.beginGesture('marquee-rect', 'new', PAGE_A, { x: 4, y: 4 })
    sel.trackPointer({ x: 12, y: 12 }, { constrain: false, fromCenter: false, freehand: false })
    expect(sel.heldPage()).not.toBe(PAGE_A.page)
    expect(editor.canUndo).toBe(false)

    sel.commitGesture()
    expect(sel.bounds).toEqual({ x: 4, y: 4, w: 8, h: 8 })
    expect(editor.canUndo).toBe(true)
  })

  it('cancelling one costs nothing', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 4, h: 4 })
    sel.beginGesture('marquee-rect', 'new', PAGE_A, { x: 10, y: 10 })
    sel.trackPointer({ x: 20, y: 20 }, { constrain: false, fromCenter: false, freehand: false })
    sel.cancelGesture()

    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 4, h: 4 })
    expect(editor.canUndo).toBe(true)
    editor.undo()
    expect(sel.hasSelection).toBe(false)
  })

  /**
   * The whole reason preview and commit share `gestureShape` and `composeInto`:
   * the marching ants during a drag are traced from this very array, so if the
   * two could disagree the shape would jump on release.
   */
  it('previews exactly what the release will leave behind', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 12, h: 12 })
    sel.beginGesture('marquee-ellipse', 'subtract', PAGE_A, { x: 6, y: 6 })
    sel.trackPointer({ x: 18, y: 18 }, { constrain: false, fromCenter: false, freehand: false })

    const shown = sel.displayFor(PAGE_A.page)
    expect(shown).not.toBeNull()
    const region = shown!.region
    const previewed = [...shown!.bytes]
    const previewBounds = shown?.bounds

    sel.commitGesture()
    expect([...(sel.maskPatchOf(PAGE_A.page, region) as Uint8ClampedArray)]).toEqual(previewed)
    expect(sel.bounds).toEqual(previewBounds)
  })

  it('shows a subtraction as it really is while the pointer is still down', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 16, h: 16 })
    sel.beginGesture('marquee-rect', 'subtract', PAGE_A, { x: 0, y: 0 })
    sel.trackPointer({ x: 8, y: 16 }, { constrain: false, fromCenter: false, freehand: false })
    const shown = sel.displayFor(PAGE_A.page)
    expect(shown?.bounds).toEqual({ x: 8, y: 0, w: 8, h: 16 })
  })

  it('recomputes what the last frame dirtied, so a shrinking drag leaves nothing behind', () => {
    const sel = useSelectionStore()
    sel.beginGesture('marquee-rect', 'new', PAGE_A, { x: 4, y: 4 })
    const mods = { constrain: false, fromCenter: false, freehand: false }
    sel.trackPointer({ x: 24, y: 24 }, mods)
    sel.displayFor(PAGE_A.page)
    sel.trackPointer({ x: 8, y: 8 }, mods)
    expect(sel.displayFor(PAGE_A.page)?.bounds).toEqual({ x: 4, y: 4, w: 4, h: 4 })
  })

  it('follows the hand between clicks of a polygon', () => {
    const sel = useSelectionStore()
    const mods = { constrain: false, fromCenter: false, freehand: false }
    sel.beginGesture('lasso-polygon', 'new', PAGE_A, { x: 4, y: 4 })
    expect(sel.releasePointer({ moved: false })).toBe('open')
    sel.trackPointer({ x: 20, y: 4 }, mods)
    sel.pressPointer({ x: 20, y: 4 })
    expect(sel.releasePointer({ moved: false })).toBe('open')
    sel.trackPointer({ x: 20, y: 20 }, mods)

    // Three vertices with the pointer standing in as the third, so there is a
    // region to show before the third click has happened.
    expect(sel.displayFor(PAGE_A.page)?.bounds).not.toBeNull()
    sel.commitGesture()
    expect(sel.bounds).toEqual({ x: 4, y: 4, w: 16, h: 16 })
  })

  /**
   * Only a polygon is built from clicks, so only a polygon survives a release.
   * Reading Alt again here would leave a subtracting lasso — Alt was held as the
   * drag began to say so — unable to finish by letting go.
   */
  it('finishes a lasso on release however the modifiers stand', () => {
    const sel = useSelectionStore()
    for (const op of ['new', 'subtract'] as const) {
      select(sel, PAGE_A, { x: 0, y: 0, w: 24, h: 24 })
      sel.beginGesture('lasso', op, PAGE_A, { x: 4, y: 4 })
      sel.trackPointer({ x: 12, y: 4 }, { constrain: false, fromCenter: false, freehand: false })
      sel.trackPointer({ x: 12, y: 12 }, { constrain: false, fromCenter: false, freehand: false })
      expect(sel.releasePointer({ moved: true })).toBe('commit')
    }
  })

  it('finishes a marquee on release', () => {
    const sel = useSelectionStore()
    sel.beginGesture('marquee-ellipse', 'new', PAGE_A, { x: 4, y: 4 })
    sel.trackPointer({ x: 12, y: 12 }, { constrain: false, fromCenter: false, freehand: false })
    expect(sel.releasePointer({ moved: true })).toBe('commit')
  })

  it('only takes freehand points into a polygon while Alt is down', () => {
    const sel = useSelectionStore()
    sel.beginGesture('lasso-polygon', 'new', PAGE_A, { x: 4, y: 4 })
    sel.trackPointer({ x: 8, y: 8 }, { constrain: false, fromCenter: false, freehand: false })
    expect(sel.gesture?.points.length).toBe(1)
    sel.trackPointer({ x: 12, y: 12 }, { constrain: false, fromCenter: false, freehand: true })
    expect(sel.gesture?.points.length).toBe(2)
  })
})

/**
 * What a gesture is describing is a separate matter from what it will do to the
 * selection, and both have to be visible. Quick Mask depends on it entirely: a
 * wash has no crisp edge, so without this a drag in that mode would show its
 * effect and never its boundary.
 */
describe('showing the gesture itself', () => {
  const mods = { constrain: false, fromCenter: false, freehand: false }

  it('outlines the shape being dragged, apart from the result', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 16, h: 16 })
    sel.beginGesture('marquee-rect', 'subtract', PAGE_A, { x: 8, y: 8 })
    sel.trackPointer({ x: 24, y: 24 }, mods)

    const shape = sel.shapeOutlinesFor(PAGE_A.page)
    expect(shape.length).toBe(1)
    expect(new Set(shape[0].map((p) => `${p.x},${p.y}`))).toEqual(
      new Set(['8,8', '24,8', '24,24', '8,24']),
    )
    // The result is a different shape: the corner taken out of the selection.
    expect(sel.displayFor(PAGE_A.page)?.bounds).toEqual({ x: 0, y: 0, w: 16, h: 16 })
  })

  it('has nothing to outline with no gesture, or on another page', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 4, h: 4 })
    expect(sel.shapeOutlinesFor(PAGE_A.page)).toEqual([])
    sel.beginGesture('marquee-rect', 'new', PAGE_A, { x: 4, y: 4 })
    sel.trackPointer({ x: 12, y: 12 }, mods)
    expect(sel.shapeOutlinesFor(PAGE_B.page)).toEqual([])
  })

  it('gives a polygon a line to show before it encloses anything', () => {
    const sel = useSelectionStore()
    sel.beginGesture('lasso-polygon', 'new', PAGE_A, { x: 4, y: 4 })
    sel.releasePointer({ moved: false })

    // One vertex placed and the pointer standing in as the second: no region
    // yet, so the line is the only thing there is to draw.
    sel.trackPointer({ x: 20, y: 4 }, mods)
    expect(sel.shapeOutlinesFor(PAGE_A.page)).toEqual([])
    expect(sel.buildingPathFor(PAGE_A.page)).toEqual([
      { x: 4, y: 4 },
      { x: 20, y: 4 },
    ])
  })

  it('drops the line once the region can speak for itself', () => {
    const sel = useSelectionStore()
    sel.beginGesture('lasso-polygon', 'new', PAGE_A, { x: 4, y: 4 })
    sel.releasePointer({ moved: false })
    sel.trackPointer({ x: 20, y: 4 }, mods)
    sel.pressPointer({ x: 20, y: 4 })
    sel.releasePointer({ moved: false })
    sel.trackPointer({ x: 20, y: 20 }, mods)

    expect(sel.buildingPathFor(PAGE_A.page)).toEqual([])
    expect(sel.shapeOutlinesFor(PAGE_A.page).length).toBe(1)
  })

  it('never draws a building line for a marquee or a freehand lasso', () => {
    const sel = useSelectionStore()
    sel.beginGesture('marquee-rect', 'new', PAGE_A, { x: 4, y: 4 })
    expect(sel.buildingPathFor(PAGE_A.page)).toEqual([])
    sel.cancelGesture()
    sel.beginGesture('lasso', 'new', PAGE_A, { x: 4, y: 4 })
    sel.trackPointer({ x: 12, y: 4 }, mods)
    expect(sel.buildingPathFor(PAGE_A.page)).toEqual([])
  })
})

describe('undo inside a gesture', () => {
  const mods = { constrain: false, fromCenter: false, freehand: false }

  function threeVertices(sel: Selection): void {
    sel.beginGesture('lasso-polygon', 'new', PAGE_A, { x: 4, y: 4 })
    sel.releasePointer({ moved: false })
    sel.trackPointer({ x: 20, y: 4 }, mods)
    sel.pressPointer({ x: 20, y: 4 })
    sel.releasePointer({ moved: false })
    sel.trackPointer({ x: 20, y: 20 }, mods)
    sel.pressPointer({ x: 20, y: 20 })
    sel.releasePointer({ moved: false })
  }

  it('takes a vertex back and puts it forward again', () => {
    const sel = useSelectionStore()
    threeVertices(sel)
    expect(sel.gesture?.points.length).toBe(3)

    expect(sel.gestureUndo()).toBe(true)
    expect(sel.gesture?.points.length).toBe(2)
    expect(sel.gestureRedo()).toBe(true)
    expect(sel.gesture?.points.length).toBe(3)
  })

  it('cancels the gesture when the last vertex goes, never reaching the document', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 4, h: 4 })
    threeVertices(sel)

    expect(sel.gestureUndo()).toBe(true)
    expect(sel.gestureUndo()).toBe(true)
    expect(sel.gestureUndo()).toBe(true)
    expect(sel.isDrawing).toBe(false)
    // The selection the gesture was drawn over is still there and still the
    // only thing on the stack.
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 4, h: 4 })
    expect(editor.canUndo).toBe(true)
  })

  it('swallows a redo with nothing to redo rather than letting it through', () => {
    const sel = useSelectionStore()
    threeVertices(sel)
    expect(sel.gestureRedo()).toBe(true)
    expect(sel.gesture?.points.length).toBe(3)
  })

  it('reports nothing handled when no gesture is running', () => {
    const sel = useSelectionStore()
    expect(sel.gestureUndo()).toBe(false)
    expect(sel.gestureRedo()).toBe(false)
  })

  it('throws away its own history on commit', () => {
    const sel = useSelectionStore()
    threeVertices(sel)
    sel.gestureUndo()
    sel.commitGesture()
    expect(sel.gestureRedo()).toBe(false)
  })
})

describe('the brush', () => {
  it('paints into the mask and lands as one command per stroke', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    sel.beginStroke(PAGE_A, 'paint', { x: 8, y: 8 })
    sel.strokeTo({ x: 12, y: 8 })
    sel.strokeTo({ x: 16, y: 8 })
    sel.endStroke()

    expect(maskAt(sel, PAGE_A, 12, 8)).toBe(255)
    editor.undo()
    expect(sel.hasSelection).toBe(false)
  })

  it('erases back out of what was selected', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    sel.selectAll(PAGE_A)
    sel.beginStroke(PAGE_A, 'erase', { x: 16, y: 16 })
    sel.strokeTo({ x: 16, y: 16 })
    sel.endStroke()
    expect(maskAt(sel, PAGE_A, 16, 16)).toBe(0)

    editor.undo()
    expect(maskAt(sel, PAGE_A, 16, 16)).toBe(255)
  })

  it('pushes nothing for a stroke that changed nothing', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    sel.brushes.paint.size = 0
    sel.beginStroke(PAGE_A, 'paint', { x: 8, y: 8 })
    sel.endStroke()
    expect(editor.canUndo).toBe(false)
  })

  it('takes the outgoing page with it when the stroke lands somewhere else', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    select(sel, PAGE_A, { x: 0, y: 0, w: 8, h: 8 })
    sel.beginStroke(PAGE_B, 'paint', { x: 16, y: 16 })
    sel.endStroke()
    expect(sel.heldPage()).toBe(PAGE_B.page)

    editor.undo()
    expect(sel.heldPage()).toBe(PAGE_A.page)
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 8, h: 8 })
  })

  it('steps its size proportionally and stops at the ends', () => {
    const sel = useSelectionStore()
    sel.brushes.paint.size = 100
    sel.nudgeBrushSize('paint', 1)
    expect(sel.brushes.paint.size).toBe(110)
    sel.nudgeBrushSize('paint', -1)
    expect(sel.brushes.paint.size).toBe(99)
    sel.brushes.paint.size = 1
    sel.nudgeBrushSize('paint', -1)
    expect(sel.brushes.paint.size).toBe(1)
  })

  it('sizes the two directions apart', () => {
    const sel = useSelectionStore()
    const painting = sel.brushes.paint.size
    sel.brushes.erase.size = 200
    sel.nudgeBrushSize('erase', 1)
    expect(sel.brushes.erase.size).toBe(220)
    expect(sel.brushes.paint.size).toBe(painting)
  })

  it('keeps an opacity per direction, and clamps it to the range', () => {
    const sel = useSelectionStore()
    sel.setBrushOpacity('erase', 0.3)
    expect(sel.brushes.erase.opacity).toBe(0.3)
    expect(sel.brushes.paint.opacity).toBe(1)
    sel.setBrushOpacity('erase', 4)
    expect(sel.brushes.erase.opacity).toBe(1)
  })

  it('strokes no deeper than its opacity, however far it doubles back', () => {
    const sel = useSelectionStore()
    sel.setBrushOpacity('paint', 0.5)
    sel.beginStroke(PAGE_A, 'paint', { x: 16, y: 16 })
    sel.strokeTo({ x: 24, y: 16 })
    sel.strokeTo({ x: 16, y: 16 })
    sel.endStroke()
    expect(maskAt(sel, PAGE_A, 16, 16)).toBe(128)
  })

  it('strokes at the size belonging to the direction it is drawing', () => {
    const sel = useSelectionStore()
    sel.brushes.paint.size = 0
    sel.brushes.erase.size = 40
    sel.selectAll(PAGE_A)
    sel.beginStroke(PAGE_A, 'erase', { x: 16, y: 16 })
    sel.endStroke()
    expect(maskAt(sel, PAGE_A, 16, 16)).toBe(0)
  })
})

describe('quick mask', () => {
  it('toggles', () => {
    const sel = useSelectionStore()
    expect(sel.quickMask).toBe(false)
    sel.toggleQuickMask()
    expect(sel.quickMask).toBe(true)
  })
})

describe('reset', () => {
  it('drops everything a project left behind', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    sel.toggleQuickMask()
    sel.reset()
    expect(sel.hasSelection).toBe(false)
    expect(sel.heldPage()).toBeNull()
    expect(sel.quickMask).toBe(false)
  })
})

describe('outlines', () => {
  it('traces the selection on the page asked for and nothing on the others', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    const loops = sel.outlinesFor(PAGE_A.page)
    expect(loops.length).toBe(1)
    expect(new Set(loops[0].map((p) => `${p.x},${p.y}`))).toEqual(
      new Set(['4,4', '12,4', '12,12', '4,12']),
    )
    expect(sel.outlinesFor(PAGE_B.page)).toEqual([])
  })

  it('has no outlines with nothing selected', () => {
    const sel = useSelectionStore()
    expect(sel.outlinesFor(PAGE_A.page)).toEqual([])
  })
})

/**
 * What lets the Quick Mask wash repaint one stamp instead of the whole
 * selection. Answering it wrongly paints the wrong pixels and nothing
 * downstream would notice, so the cases that must refuse matter more than the
 * one that returns a rectangle.
 */
describe('dirtySince', () => {
  it('reports nothing changed when the caller is already up to date', () => {
    const sel = useSelectionStore()
    expect(sel.dirtySince(sel.revision)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  /** Room for the default brush to land without every stamp clipping to it. */
  const WIDE: MaskTarget = { page: 'p003.png', w: 400, h: 300 }

  it('unions the stamps a stroke laid down since the caller last looked', () => {
    const sel = useSelectionStore()
    sel.beginStroke(WIDE, 'paint', { x: 100, y: 100 })
    const from = sel.revision
    sel.strokeTo({ x: 140, y: 100 })
    sel.strokeTo({ x: 180, y: 100 })

    const dirty = sel.dirtySince(from)
    expect(dirty).not.toBeNull()
    expect(dirty!.x).toBeLessThanOrEqual(140)
    expect(dirty!.x + dirty!.w).toBeGreaterThanOrEqual(180)
    // Bounded by the stroke, not by the page: this is the whole point of it.
    expect(dirty!.w).toBeLessThan(WIDE.w)
    expect(dirty!.h).toBeLessThan(WIDE.h)
  })

  it('refuses when a change that reported no region came in between', () => {
    const sel = useSelectionStore()
    sel.beginStroke(PAGE_A, 'paint', { x: 6, y: 6 })
    const from = sel.revision
    sel.strokeTo({ x: 12, y: 6 })
    // Select-all rewrites the whole mask and logs no region. The gap it leaves
    // is the only thing between a stale wash and a wrong one.
    sel.selectAll(PAGE_A)
    expect(sel.dirtySince(from)).toBeNull()
  })

  it('refuses when the caller last looked before the log began', () => {
    const sel = useSelectionStore()
    sel.selectAll(PAGE_A)
    const stale = sel.revision
    sel.deselect()
    sel.beginStroke(PAGE_A, 'paint', { x: 6, y: 6 })
    sel.strokeTo({ x: 12, y: 6 })
    expect(sel.dirtySince(stale)).toBeNull()
  })

  it('refuses a revision it has not reached', () => {
    const sel = useSelectionStore()
    expect(sel.dirtySince(sel.revision + 1)).toBeNull()
  })
})

/**
 * What the tiles are for. A selection is a full-page 8-bit mask, so a page-sized
 * array was what one cost however little of the page it covered — 139 MB at the
 * largest page, and selecting all or inverting has the whole page as its changed
 * region, so two of those in history was 278 MB for one command.
 */
describe('what a selection costs', () => {
  const SMALL: MaskTarget = { page: 'p001.png', w: 64, h: 64 }
  const LARGE: MaskTarget = { page: 'p001.png', w: 2048, h: 2048 }

  it('costs the same on a large page as on a small one', () => {
    const sel = useSelectionStore()
    select(sel, SMALL, { x: 0, y: 0, w: 8, h: 8 })
    const onSmall = engine.maskBytesHeld()

    engine.maskReset()
    setActivePinia(createPinia())
    select(useSelectionStore(), LARGE, { x: 0, y: 0, w: 8, h: 8 })

    expect(engine.maskBytesHeld()).toBe(onSmall)
  })

  /**
   * The 500× line. A thousand tiles of page selected whole is one block and a
   * thousand pointers at it, and the record that takes it back holds the same
   * one block rather than a second copy of the page.
   */
  it('holds one block for a whole page selected and taken back', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    sel.selectAll(LARGE)
    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 2048, h: 2048 })

    const held = engine.maskBytesHeld()
    editor.undo()

    // One 64×64 block of a single byte a pixel, whichever side of the undo we
    // are on — against the eight megabytes this page's mask would be as an array.
    expect(held).toBe(4096)
    expect(engine.maskBytesHeld()).toBe(4096)
    expect(sel.hasSelection).toBe(false)
  })

  it('brings the whole page back on redo', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    sel.selectAll(LARGE)
    editor.undo()
    editor.redo()

    expect(sel.bounds).toEqual({ x: 0, y: 0, w: 2048, h: 2048 })
    expect(maskAt(sel, LARGE, 2047, 2047)).toBe(255)
  })
})
