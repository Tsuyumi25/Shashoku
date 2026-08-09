import type { Ref } from 'vue'
import { pixelHexAt } from '@/lib/color'
import { screenToContentPx } from '@/lib/coords'
import { heldSinceStart } from '@/lib/selection/marquee'
import type { SelectionOp } from '@/lib/selection/mask'
import type { Point } from '@/lib/selection/rect'
import { magicWandRaster } from '@/lib/selection/wand'
import { maskBrushModeOf, useEditorStore, type CanvasTool } from '@/stores/editorStore'
import {
  isPolygonGesture,
  useSelectionStore,
  type SelectionGestureKind,
} from '@/stores/selectionStore'

/** Screen pixels of travel before a press counts as a drag rather than a click. */
const DRAG_SLOP = 3

/** How near its first vertex a click has to land to close a polygon, on screen. */
const CLOSE_REACH_PX = 8

const GESTURE_OF: Partial<Record<CanvasTool, SelectionGestureKind>> = {
  'marquee-rect': 'marquee-rect',
  'marquee-ellipse': 'marquee-ellipse',
  lasso: 'lasso',
  'lasso-polygon': 'lasso-polygon',
}

/**
 * The pointer half of the selection tools. Each handler answers whether it took
 * the event, so the canvas's own gestures — panning, rotating, placing text —
 * are left to run when no selection tool is up.
 */
export function useSelectionTool(
  container: Ref<HTMLElement | null>,
  /**
   * The page's artwork, already laid out on the page's own grid, or null while
   * there is none to read. Page-sized on arrival, so a point on the page is a
   * point in it and nothing here has to know where any layer sits.
   */
  artwork: () => CanvasImageSource | null,
  ready: () => boolean,
) {
  const editor = useEditorStore()
  const selection = useSelectionStore()

  let pressed = false
  let pressAt = { x: 0, y: 0 }
  let moved = false

  /**
   * Photoshop's modifier timing needs to know not just whether Shift is down
   * but whether it has been down since the drag began: held from the start it
   * means add, pressed afterwards it means constrain.
   */
  let shiftAtStart = false
  let altAtStart = false
  let shiftReleased = false
  let altReleased = false

  /**
   * The artwork's pixels, read back once per page and kept until something
   * makes them wrong. The wand reads these rather than the screen: it is there
   * to find a balloon, and a translation sitting inside that balloon is not
   * part of it.
   */
  let sample: { page: string; pixels: Uint8ClampedArray } | null = null

  function dropPageSample(): void {
    sample = null
  }

  function pagePixels(): Uint8ClampedArray | null {
    const page = editor.currentPageId
    const { w, h } = editor.viewContentSize
    if (page === null || !ready() || w <= 0 || h <= 0) return null
    if (sample?.page === page) return sample.pixels
    // Null while the composite is still out. Caching an empty read under this
    // page's name would answer every later click for it too.
    const source = artwork()
    if (!source) return null
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(source, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    sample = { page, pixels }
    return pixels
  }

  function pageAt(e: MouseEvent): Point | null {
    const el = container.value
    if (!el) return null
    return screenToContentPx(e.clientX, e.clientY, el.getBoundingClientRect(), editor.view)
  }

  function opOf(e: { shiftKey: boolean; altKey: boolean }): SelectionOp {
    if (e.shiftKey && e.altKey) return 'intersect'
    if (e.shiftKey) return 'add'
    if (e.altKey) return 'subtract'
    return 'new'
  }

  function modifiers(e: PointerEvent) {
    if (!e.shiftKey) shiftReleased = true
    if (!e.altKey) altReleased = true
    return {
      constrain: heldSinceStart(shiftAtStart, shiftReleased, e.shiftKey),
      fromCenter: heldSinceStart(altAtStart, altReleased, e.altKey),
      // Alt with the button down draws a freehand stretch into a polygon, which
      // is Adobe's own rule; that it also picked "subtract" as the press landed
      // is no conflict, since the operation was settled then and is now fixed.
      freehand: e.altKey,
    }
  }

  function nearFirstVertex(first: Point, at: Point): boolean {
    const reach = CLOSE_REACH_PX / Math.max(0.01, editor.view.scale)
    return Math.hypot(at.x - first.x, at.y - first.y) <= reach
  }

  function onPointerDown(e: PointerEvent): boolean {
    const target = editor.maskTarget
    const at = pageAt(e)
    if (target === null || at === null) return false
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pressed = true
    pressAt = { x: e.clientX, y: e.clientY }
    moved = false

    if (editor.tool === 'wand') {
      const pixels = pagePixels()
      if (pixels !== null) {
        selection.applyShape(
          target,
          magicWandRaster(pixels, target.w, target.h, at),
          opOf(e),
          'select-wand',
        )
      }
      return true
    }
    const brushMode = maskBrushModeOf(editor.tool)
    if (brushMode !== null) {
      // Refused rather than merely invisible. These draw the mask and the mask
      // is only on screen in Quick Mask, so painting outside that mode would
      // leave no trace — which is what the greyed button is saying.
      if (selection.quickMask) selection.beginStroke(target, brushMode, at)
      return true
    }

    const kind = GESTURE_OF[editor.tool]
    if (kind === undefined) return false
    // A polygon already under way reads this press as one of its clicks.
    if (selection.isDrawing) {
      selection.pressPointer(at)
      return true
    }
    shiftAtStart = e.shiftKey
    altAtStart = e.altKey
    shiftReleased = false
    altReleased = false
    selection.beginGesture(kind, opOf(e), target, at)
    return true
  }

  function onPointerMove(e: PointerEvent): boolean {
    if (!pressed && !selection.isDrawing) return false
    const at = pageAt(e)
    if (at === null) return false
    if (Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) >= DRAG_SLOP) moved = true
    if (maskBrushModeOf(editor.tool) !== null) {
      if (pressed) selection.strokeTo(at)
      return true
    }
    if (editor.tool === 'wand') return true
    selection.trackPointer(at, modifiers(e))
    return true
  }

  /**
   * A cancelled pointer is taken as a release, which is this canvas's standing
   * convention: work in progress is banked rather than thrown away when the
   * system takes the pointer.
   */
  function onPointerUp(e: PointerEvent): boolean {
    const wasPressed = pressed
    pressed = false
    if (maskBrushModeOf(editor.tool) !== null) {
      if (wasPressed) selection.endStroke()
      return wasPressed
    }
    if (!selection.isDrawing) return wasPressed

    const gesture = selection.gesture
    const at = pageAt(e)
    if (
      gesture !== null &&
      isPolygonGesture(gesture) &&
      !moved &&
      at !== null &&
      gesture.points.length >= 3 &&
      nearFirstVertex(gesture.points[0], at)
    ) {
      selection.commitGesture()
      return true
    }
    if (selection.releasePointer({ moved }) === 'commit') selection.commitGesture()
    return true
  }

  /**
   * The other way to finish a polygon, as in every vector editor — and only a
   * polygon, since every other gesture ended when the button came up.
   */
  function onDoubleClick(): boolean {
    const gesture = selection.gesture
    if (gesture === null || !isPolygonGesture(gesture)) return false
    selection.commitGesture()
    return true
  }

  /**
   * The colour of the page under the pointer, for whoever wants to sample it.
   * The wand already decodes the page once and keeps it, so this costs a lookup
   * rather than a read-back — which is why it is offered from here rather than
   * being sampled again somewhere else.
   */
  function colorAt(e: MouseEvent): string | null {
    const pixels = pagePixels()
    const at = pageAt(e)
    const { w, h } = editor.viewContentSize
    if (pixels === null || at === null) return null
    return pixelHexAt(pixels, w, h, at.x, at.y)
  }

  return { onPointerDown, onPointerMove, onPointerUp, onDoubleClick, dropPageSample, colorAt }
}
