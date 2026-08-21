/**
 * Where the caret stands on screen, in client pixels.
 *
 * `x, y` is the corner the run starts from — its leading edge on the writing
 * axis, its top or right edge on the cross axis — before the angle is applied,
 * so the box that lands there is turned about that same corner.
 */
export interface CaretOnScreen {
  x: number
  y: number
  width: number
  height: number
  /** The run's turn on screen: the view's and the object's, as drawn. */
  angle: number
  vertical: boolean
}

export interface PinnedBox {
  left: number
  top: number
  width: number
  height: number
  angle: number
  vertical: boolean
}

/**
 * How small a side the native control may be.
 *
 * ⚠️ Not a rounding convenience. A Korean IME is severely broken by a control
 * measuring 0×0, and zooming out far enough would otherwise round one side to
 * nothing.
 */
const MIN_SIDE_PX = 1

function clamp(value: number, min: number, max: number): number {
  // Ordered so that a viewport smaller than the box lands it inside rather than
  // outside: the low bound wins, which keeps the control on screen.
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * The input's own box, sized and placed so an IME's candidate window opens
 * beside the text rather than beside the panel the box lives in.
 *
 * ⚠️ The position is corrected here rather than after it is written. A focused
 * element lying outside the window makes the browser scroll the document to
 * reach it, and this application's document is its entire layout — so an
 * unchecked position does not misplace a popup, it slides the whole interface.
 * fabric.js shipped that bug.
 *
 * The cross axis keeps the caret's full extent, which is the line's. That is
 * also what macOS wants: its own popups are placed against the control's box,
 * so a control shorter than the line puts them through the text.
 */
export function pinnedInputBox(caret: CaretOnScreen, viewport: { w: number; h: number }): PinnedBox {
  const width = Math.max(MIN_SIDE_PX, Math.round(caret.width))
  const height = Math.max(MIN_SIDE_PX, Math.round(caret.height))
  return {
    left: clamp(caret.x, 0, viewport.w - width),
    top: clamp(caret.y, 0, viewport.h - height),
    width,
    height,
    angle: caret.angle,
    vertical: caret.vertical,
  }
}
