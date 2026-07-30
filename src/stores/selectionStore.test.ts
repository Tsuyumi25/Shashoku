import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditorStore } from '@/stores/editorStore'
import { useSelectionStore, type MaskTarget } from '@/stores/selectionStore'
import { rasterizeRect } from '@/lib/selection/raster'
import type { SelectionOp } from '@/lib/selection/mask'
import type { Rect } from '@/lib/selection/rect'

const PAGE_A: MaskTarget = { page: 'p001.png', w: 32, h: 32 }
const PAGE_B: MaskTarget = { page: 'p002.png', w: 32, h: 32 }

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
  const mask = sel.maskFor(target.page)
  return mask === null ? 0 : mask[y * target.w + x]
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('holding one selection', () => {
  it('starts with nothing', () => {
    const sel = useSelectionStore()
    expect(sel.hasSelection).toBe(false)
    expect(sel.bounds).toBeNull()
    expect(sel.maskFor(PAGE_A.page)).toBeNull()
  })

  it('remembers which page it is for', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    expect(sel.bounds).toEqual({ x: 4, y: 4, w: 8, h: 8 })
    expect(sel.maskFor(PAGE_A.page)).not.toBeNull()
    // Hidden on another page, not destroyed by looking away from it.
    expect(sel.maskFor(PAGE_B.page)).toBeNull()
    expect(sel.displayFor(PAGE_B.page)).toBeNull()
    expect(sel.heldPage()).toBe(PAGE_A.page)
  })

  it('is replaced by selecting on another page', () => {
    const sel = useSelectionStore()
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    select(sel, PAGE_B, { x: 0, y: 0, w: 4, h: 4 })
    expect(sel.heldPage()).toBe(PAGE_B.page)
    expect(sel.maskFor(PAGE_A.page)).toBeNull()
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
    editor.currentFilename = PAGE_A.page
    select(sel, PAGE_A, { x: 4, y: 4, w: 8, h: 8 })
    editor.currentFilename = PAGE_B.page

    editor.undo()
    expect(editor.currentFilename).toBe(PAGE_A.page)
    editor.currentFilename = PAGE_B.page
    editor.redo()
    expect(editor.currentFilename).toBe(PAGE_A.page)
  })
})

describe('gestures', () => {
  it('leaves the held mask alone until the release', () => {
    const sel = useSelectionStore()
    const editor = useEditorStore()
    sel.beginGesture('marquee-rect', 'new', PAGE_A, { x: 4, y: 4 })
    sel.trackPointer({ x: 12, y: 12 }, { constrain: false, fromCenter: false, freehand: false })
    expect(sel.maskFor(PAGE_A.page)).toBeNull()
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
    const previewed = [...(shown as { mask: Uint8ClampedArray }).mask]
    const previewBounds = shown?.bounds

    sel.commitGesture()
    expect([...(sel.maskFor(PAGE_A.page) as Uint8ClampedArray)]).toEqual(previewed)
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
    sel.brushSize = 0
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
    sel.brushSize = 100
    sel.nudgeBrushSize(1)
    expect(sel.brushSize).toBe(110)
    sel.nudgeBrushSize(-1)
    expect(sel.brushSize).toBe(99)
    sel.brushSize = 1
    sel.nudgeBrushSize(-1)
    expect(sel.brushSize).toBe(1)
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
