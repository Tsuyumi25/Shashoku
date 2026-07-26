import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { clamp, type ViewTransform } from '@/lib/coords'

export interface Size {
  w: number
  h: number
}

const ZOOM_SPEED = 0.0015
const MAX_SCALE = 40

/**
 * The view transform state machine. `view` maps content px to container px:
 * `translate(tx,ty) ∘ scale ∘ rotate` with a `0 0` origin (see lib/coords).
 * The canvas feeds it to `ctx.setTransform`, the marker stage to a CSS
 * transform — same transform, two ways of showing it.
 */
export function useZoomPan(
  containerSize: MaybeRefOrGetter<Size>,
  contentSize: MaybeRefOrGetter<Size>,
) {
  const view = reactive<ViewTransform>({ scale: 1, tx: 0, ty: 0, rotate: 0 })
  const ready = ref(false)

  function fitScale(): number {
    const container = toValue(containerSize)
    const content = toValue(contentSize)
    if (!container.w || !container.h || !content.w || !content.h) return 1
    return Math.min(container.w / content.w, container.h / content.h)
  }

  /**
   * Returns false and leaves the view alone when either size is still unknown
   * — a hidden container measures 0×0, and fitting against that would throw
   * away the view the user left behind.
   */
  function fitToView(): boolean {
    const container = toValue(containerSize)
    const content = toValue(contentSize)
    if (!container.w || !container.h || !content.w || !content.h) return false
    const s = fitScale()
    view.scale = s
    view.rotate = 0
    view.tx = (container.w - content.w * s) / 2
    view.ty = (container.h - content.h * s) / 2
    ready.value = true
    return true
  }

  /**
   * Rotate to `theta` while the content under the screen pivot stays put.
   * From `screen = t + s·R(θ)·c`: solve for the content point under the pivot,
   * then back out the translation the new angle needs.
   */
  function rotateTo(theta: number, px: number, py: number) {
    const cos1 = Math.cos(view.rotate)
    const sin1 = Math.sin(view.rotate)
    const ix = (px - view.tx) / view.scale
    const iy = (py - view.ty) / view.scale
    const cx = ix * cos1 + iy * sin1
    const cy = -ix * sin1 + iy * cos1

    const cos2 = Math.cos(theta)
    const sin2 = Math.sin(theta)
    view.tx = px - view.scale * (cx * cos2 - cy * sin2)
    view.ty = py - view.scale * (cx * sin2 + cy * cos2)
    view.rotate = theta
  }

  /** Zoom to `next`, keeping the content under the screen point (px,py) fixed. */
  function zoomTo(next: number, px: number, py: number) {
    const clamped = clamp(next, fitScale() * 0.5, MAX_SCALE)
    if (clamped === view.scale) return
    const k = clamped / view.scale
    view.tx = px - (px - view.tx) * k
    view.ty = py - (py - view.ty) * k
    view.scale = clamped
  }

  /** Anchored on the container centre, for the bottom bar's +/- buttons. */
  function zoomBy(factor: number) {
    const container = toValue(containerSize)
    zoomTo(view.scale * factor, container.w / 2, container.h / 2)
  }

  /** Plain cursor-anchored zoom — the LabelPlus wheel convention. */
  function wheelZoom(e: WheelEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    zoomTo(view.scale * Math.exp(-e.deltaY * ZOOM_SPEED), e.clientX - rect.left, e.clientY - rect.top)
  }

  function panBy(dx: number, dy: number) {
    view.tx += dx
    view.ty += dy
  }

  return { view, ready, fitScale, fitToView, wheelZoom, zoomBy, panBy, rotateTo }
}
