import { describe, expect, it } from 'vitest'
import {
  centeredBoxOnScreen,
  contentToScreenPx,
  framePoint,
  positionHolding,
  screenToContentPx,
  screenToFramePx,
  screenToPagePx,
  smoothingQualityFor,
  travelSinceGrab,
  turnedAround,
  type ViewTransform,
} from './coords'

const ORIGIN = { left: 0, top: 0 }

describe('coords with view rotation', () => {
  it('screenToContentPx inverts contentToScreenPx, rotation included', () => {
    const view: ViewTransform = { scale: 1.7, tx: 120, ty: -40, rotate: Math.PI / 7 }
    const p = { x: 333, y: 218 }
    const s = contentToScreenPx(p.x, p.y, view)
    const back = screenToContentPx(s.x, s.y, ORIGIN, view)
    expect(back.x).toBeCloseTo(p.x, 6)
    expect(back.y).toBeCloseTo(p.y, 6)
  })

  it('degenerates to plain translate + scale when rotate is 0', () => {
    const view: ViewTransform = { scale: 2, tx: 10, ty: 20, rotate: 0 }
    expect(screenToContentPx(30, 60, ORIGIN, view)).toEqual({ x: 10, y: 20 })
    expect(contentToScreenPx(10, 20, view)).toEqual({ x: 30, y: 60 })
  })

  it('maps the content +x axis onto the screen +y axis at 90 degrees', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: Math.PI / 2 }
    const s = contentToScreenPx(10, 0, view)
    expect(s.x).toBeCloseTo(0, 6)
    expect(s.y).toBeCloseTo(10, 6)
  })
})

describe('travelSinceGrab', () => {
  it('reads a pointer that has not moved as no travel at all', () => {
    const view: ViewTransform = { scale: 1.7, tx: 120, ty: -40, rotate: Math.PI / 7 }
    const grab = screenToContentPx(300, 200, ORIGIN, view)
    expect(travelSinceGrab(grab, 300, 200, ORIGIN, view)).toEqual({ dx: 0, dy: 0 })
  })

  it('measures in page pixels rather than screen ones', () => {
    const view: ViewTransform = { scale: 2, tx: 999, ty: -999, rotate: 0 }
    const grab = screenToContentPx(300, 200, ORIGIN, view)
    expect(travelSinceGrab(grab, 310, 220, ORIGIN, view)).toEqual({ dx: 5, dy: 10 })
  })

  it('turns a downward drag into page +x at 90 degrees', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: Math.PI / 2 }
    const grab = screenToContentPx(300, 200, ORIGIN, view)
    const d = travelSinceGrab(grab, 300, 210, ORIGIN, view)
    expect(d.dx).toBeCloseTo(10, 6)
    expect(d.dy).toBeCloseTo(0, 6)
  })

  /**
   * The whole reason a grab is a page point: the view the press was taken under
   * is not the view the drag is read under. A screen distance divided by the
   * scale as it now stands is off by `travelled × (1/now − 1/then)`, which is
   * why the old way looked fine on a short drag and threw the object across the
   * page on a long one.
   */
  it('holds the grabbed point still when the view zooms mid-drag', () => {
    const pressed: ViewTransform = { scale: 0.4, tx: 0, ty: 0, rotate: 0 }
    const grab = screenToContentPx(100, 100, ORIGIN, pressed)
    const at = { x: 300, y: 100 }
    expect(travelSinceGrab(grab, at.x, at.y, ORIGIN, pressed)).toEqual({ dx: 500, dy: 0 })

    // Doubled, anchored on the pointer — what the wheel does, which is what
    // leaves the point under the cursor where it is and the press point adrift.
    const zoomed: ViewTransform = { scale: 0.8, tx: -300, ty: -100, rotate: 0 }
    expect(screenToContentPx(at.x, at.y, ORIGIN, zoomed)).toEqual(
      screenToContentPx(at.x, at.y, ORIGIN, pressed),
    )
    expect(travelSinceGrab(grab, at.x, at.y, ORIGIN, zoomed)).toEqual({ dx: 500, dy: 0 })
  })

  it('follows the pointer when the view pans mid-drag', () => {
    const pressed: ViewTransform = { scale: 2, tx: 0, ty: 0, rotate: 0 }
    const grab = screenToContentPx(100, 100, ORIGIN, pressed)
    const panned: ViewTransform = { ...pressed, tx: 30, ty: -12 }
    const d = travelSinceGrab(grab, 100, 100, ORIGIN, panned)
    expect(d).toEqual({ dx: -15, dy: 6 })
  })

  it('agrees with the difference of two mapped points', () => {
    const view: ViewTransform = { scale: 1.7, tx: 120, ty: -40, rotate: Math.PI / 7 }
    const at = { x: 300, y: 200 }
    const drag = { x: 37, y: -22 }
    const before = screenToContentPx(at.x, at.y, ORIGIN, view)
    const after = screenToContentPx(at.x + drag.x, at.y + drag.y, ORIGIN, view)
    const d = travelSinceGrab(before, at.x + drag.x, at.y + drag.y, ORIGIN, view)
    expect(d.dx).toBeCloseTo(after.x - before.x, 6)
    expect(d.dy).toBeCloseTo(after.y - before.y, 6)
  })

  it('subtracts the container offset like screenToContentPx does', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: 0 }
    const rect = { left: 60, top: 20 }
    const grab = screenToContentPx(260, 120, rect, view)
    expect(grab).toEqual({ x: 200, y: 100 })
    expect(travelSinceGrab(grab, 270, 140, rect, view)).toEqual({ dx: 10, dy: 20 })
  })
})

describe('screenToPagePx', () => {
  const NATURAL = { w: 400, h: 200 }

  it('reads a screen point as the page pixel it landed on', () => {
    const view: ViewTransform = { scale: 2, tx: 50, ty: -30, rotate: 0 }
    const s = contentToScreenPx(100, 150, view)
    expect(screenToPagePx(s.x, s.y, ORIGIN, view, NATURAL)).toEqual({ x: 100, y: 150 })
  })

  it('keeps a point between two pixels, which is where a person may put one', () => {
    const view: ViewTransform = { scale: 4, tx: 0, ty: 0, rotate: 0 }
    expect(screenToPagePx(50, 130, ORIGIN, view, NATURAL)).toEqual({ x: 12.5, y: 32.5 })
  })

  it('subtracts the container offset like screenToContentPx does', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: 0 }
    const rect = { left: 60, top: 20 }
    expect(screenToPagePx(260, 120, rect, view, NATURAL)).toEqual({ x: 200, y: 100 })
  })

  it('clamps a point off the page to its edge', () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: 0 }
    expect(screenToPagePx(-500, -500, ORIGIN, view, NATURAL)).toEqual({ x: 0, y: 0 })
    expect(screenToPagePx(9999, 9999, ORIGIN, view, NATURAL)).toEqual({ x: 400, y: 200 })
  })

  it('follows the view rotation', () => {
    const view: ViewTransform = { scale: 1.3, tx: 17, ty: -44, rotate: Math.PI / 5 }
    const s = contentToScreenPx(300, 50, view)
    const p = screenToPagePx(s.x, s.y, ORIGIN, view, NATURAL)
    expect(p.x).toBeCloseTo(300, 6)
    expect(p.y).toBeCloseTo(50, 6)
  })
})

describe('smoothingQualityFor', () => {
  it('pays for the good filter going down, which is where it is the one that helps', () => {
    expect(smoothingQualityFor(0.25)).toBe('high')
    expect(smoothingQualityFor(0.99)).toBe('high')
  })

  /**
   * The boundary the two draw sites used to disagree about. A ratio of exactly
   * 1 is 100% zoom at dpr 1 — the one moment a person can
   * hold the preview and the export side by side.
   */
  it('keeps the good filter at exactly one', () => {
    expect(smoothingQualityFor(1)).toBe('high')
  })

  it('stops paying going up, where the two filters agree anyway', () => {
    expect(smoothingQualityFor(1.5)).toBe('low')
    expect(smoothingQualityFor(8)).toBe('low')
  })
})

describe('centeredBoxOnScreen', () => {
  it('puts the centre where the view puts the anchor and scales the box with it', () => {
    const view: ViewTransform = { scale: 2, tx: 10, ty: 20, rotate: 0 }
    const box = centeredBoxOnScreen({ x: 100, y: 50 }, { w: 40, h: 20 }, view)
    expect(box).toEqual({ centerX: 210, centerY: 120, width: 80, height: 40 })
  })

  it('keeps the box axis aligned under rotation, moving only its centre', () => {
    const view: ViewTransform = { scale: 3, tx: 0, ty: 0, rotate: Math.PI / 2 }
    const box = centeredBoxOnScreen({ x: 10, y: 0 }, { w: 8, h: 4 }, view)
    expect(box.centerX).toBeCloseTo(0, 6)
    expect(box.centerY).toBeCloseTo(30, 6)
    expect(box.width).toBe(24)
    expect(box.height).toBe(12)
  })
})

describe('turnedAround', () => {
  const PIVOT = { x: 100, y: 100 }

  it('leaves the pivot itself alone', () => {
    expect(turnedAround(PIVOT, PIVOT, 1.3)).toEqual(PIVOT)
  })

  /** Clockwise as the page's axes run, Y growing downward. */
  it('takes a quarter turn from pointing right to pointing down', () => {
    const p = turnedAround(PIVOT, { x: 140, y: 100 }, Math.PI / 2)
    expect(p.x).toBeCloseTo(100, 9)
    expect(p.y).toBeCloseTo(140, 9)
  })

  it('keeps the distance it started at', () => {
    const p = turnedAround(PIVOT, { x: 130, y: 140 }, 0.7)
    expect(Math.hypot(p.x - PIVOT.x, p.y - PIVOT.y)).toBeCloseTo(50, 9)
  })
})

describe('positionHolding', () => {
  const TOP_LEFT = { x: 0, y: 0 }
  const BOTTOM_RIGHT = { x: 1, y: 1 }
  const START = { x: 0, y: 0 }

  /** The two are each other's inverse, which is the whole of what they promise. */
  it('undoes framePoint', () => {
    const held = framePoint({ x: 100, y: 60 }, { w: 40, h: 20 }, START, BOTTOM_RIGHT, 0.4)
    const back = positionHolding(held, { w: 40, h: 20 }, START, BOTTOM_RIGHT, 0.4)
    expect(back.x).toBeCloseTo(100, 9)
    expect(back.y).toBeCloseTo(60, 9)
  })

  /**
   * The size is the typesetter's output, so the corner is held against whatever
   * it reported rather than against what the drag asked for.
   */
  it('keeps the held corner still while the size around it changes', () => {
    const held = { x: 200, y: 120 }
    for (const box of [{ w: 40, h: 20 }, { w: 61, h: 31 }, { w: 7, h: 90 }]) {
      const at = positionHolding(held, box, START, BOTTOM_RIGHT, 0)
      const landed = framePoint(at, box, START, BOTTOM_RIGHT, 0)
      expect(landed.x).toBeCloseTo(held.x, 9)
      expect(landed.y).toBeCloseTo(held.y, 9)
    }
  })

  /** Holding the point the position already names cannot move the object. */
  it('leaves the position alone when the held point is the one it names', () => {
    const at = positionHolding({ x: 100, y: 60 }, { w: 40, h: 20 }, TOP_LEFT, TOP_LEFT, 1.1)
    expect(at).toEqual({ x: 100, y: 60 })
  })
})

describe('screenToFramePx', () => {
  const BOX = { w: 100, h: 40 }
  const CENTER = { x: 500, y: 300 }

  it('puts the top left corner at the origin', () => {
    const at = screenToFramePx(CENTER.x - 50, CENTER.y - 20, CENTER, BOX, 1, 0)
    expect(at.x).toBeCloseTo(0, 9)
    expect(at.y).toBeCloseTo(0, 9)
  })

  it('answers in the frame\'s own pixels rather than screen ones', () => {
    const at = screenToFramePx(CENTER.x - 100 + 20, CENTER.y - 40, CENTER, BOX, 2, 0)
    expect(at.x).toBeCloseTo(10, 9)
    expect(at.y).toBeCloseTo(0, 9)
  })

  /** A quarter turn sends the frame's +x along the screen's +y. */
  it('undoes the turn the frame is drawn with', () => {
    const at = screenToFramePx(CENTER.x, CENTER.y - 40, CENTER, BOX, 1, Math.PI / 2)
    expect(at.x).toBeCloseTo(10, 9)
    expect(at.y).toBeCloseTo(20, 9)
  })

  /**
   * The turn a frame carries is the view's and the object's added together, so
   * one test standing in for both is the whole point of taking one angle.
   */
  it('inverts the placement for any turn and scale', () => {
    const turn = Math.PI / 5
    const scale = 1.8
    const local = { x: 17, y: 33 }
    const dx = local.x - BOX.w / 2
    const dy = local.y - BOX.h / 2
    const screen = turnedAround({ x: 0, y: 0 }, { x: dx * scale, y: dy * scale }, turn)
    const back = screenToFramePx(
      CENTER.x + screen.x,
      CENTER.y + screen.y,
      CENTER,
      BOX,
      scale,
      turn,
    )
    expect(back.x).toBeCloseTo(local.x, 9)
    expect(back.y).toBeCloseTo(local.y, 9)
  })
})
