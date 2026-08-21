import { describe, expect, it } from 'vitest'
import { pinnedInputBox, type CaretOnScreen } from './pinnedInput'

const VIEWPORT = { w: 1000, h: 800 }

function caret(over: Partial<CaretOnScreen> = {}): CaretOnScreen {
  return { x: 400, y: 300, width: 2, height: 24, angle: 0, vertical: false, ...over }
}

describe('pinnedInputBox', () => {
  it('sits on the insertion point', () => {
    const box = pinnedInputBox(caret(), VIEWPORT)
    expect(box.left).toBe(400)
    expect(box.top).toBe(300)
    expect(box.width).toBe(2)
    expect(box.height).toBe(24)
  })

  it("carries the run's angle and direction through", () => {
    const box = pinnedInputBox(caret({ angle: 0.4, vertical: true }), VIEWPORT)
    expect(box.angle).toBeCloseTo(0.4, 9)
    expect(box.vertical).toBe(true)
  })

  /**
   * ⚠️ A Korean IME is severely broken by a 0×0 control, so neither side may
   * round away to nothing however far the view is zoomed out.
   */
  it('never comes out with a side of zero', () => {
    const box = pinnedInputBox(caret({ width: 0.2, height: 0.04 }), VIEWPORT)
    expect(box.width).toBeGreaterThanOrEqual(1)
    expect(box.height).toBeGreaterThanOrEqual(1)
  })

  it("keeps the caret's own line extent, which is what macOS places popups against", () => {
    const box = pinnedInputBox(caret({ height: 37.6 }), VIEWPORT)
    expect(box.height).toBe(38)
  })

  /**
   * ⚠️ A focused element outside the window makes the browser scroll the whole
   * document to reach it, which in this application is the entire layout
   * sliding out of place. So the position is corrected before it is written,
   * never after.
   */
  it('pulls a box past the right edge back inside', () => {
    const box = pinnedInputBox(caret({ x: 1400 }), VIEWPORT)
    expect(box.left).toBe(VIEWPORT.w - box.width)
  })

  it('pulls a box past the bottom edge back inside', () => {
    const box = pinnedInputBox(caret({ y: 900 }), VIEWPORT)
    expect(box.top).toBe(VIEWPORT.h - box.height)
  })

  it('pulls a box off the top left back inside', () => {
    const box = pinnedInputBox(caret({ x: -300, y: -50 }), VIEWPORT)
    expect(box.left).toBe(0)
    expect(box.top).toBe(0)
  })

  /** A window shorter than one line still has to hold the box, not push it out. */
  it('lands inside a viewport smaller than the box rather than outside it', () => {
    const box = pinnedInputBox(caret({ height: 400 }), { w: 10, h: 10 })
    expect(box.top).toBe(0)
    expect(box.left).toBe(10 - box.width)
  })
})
