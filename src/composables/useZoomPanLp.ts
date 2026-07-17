import { reactive, ref, toValue, type MaybeRefOrGetter } from 'vue'
import { clamp, type ViewTransform } from '@/lib/coords'

export interface Size {
  w: number
  h: number
}

const ZOOM_SPEED = 0.0015
const MAX_SCALE = 40

/**
 * CSS transform 型 zoom/pan（YALP 血統,翻譯 mode 專用:pan 拖曳封裝在內。嵌字 mode 用 useZoomPan(rotate 超集)）。
 * view 是 content space → container space 的變換：先 translate(tx,ty) 再 scale，
 * transform-origin 固定 0 0。滾輪縮放錨定游標：tx' = cx - (cx - tx) * k。
 */
export function useZoomPan(
  containerSize: MaybeRefOrGetter<Size>,
  contentSize: MaybeRefOrGetter<Size>,
) {
  const view = reactive<ViewTransform>({ scale: 1, tx: 0, ty: 0, rotate: 0 })
  const panning = ref(false)

  function fitScale(): number {
    const container = toValue(containerSize)
    const content = toValue(contentSize)
    if (!container.w || !container.h || !content.w || !content.h) return 1
    return Math.min(container.w / content.w, container.h / content.h)
  }

  function fitToView() {
    const container = toValue(containerSize)
    const content = toValue(contentSize)
    const s = fitScale()
    view.scale = s
    view.tx = (container.w - content.w * s) / 2
    view.ty = (container.h - content.h * s) / 2
  }

  function onWheel(e: WheelEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const next = clamp(view.scale * Math.exp(-e.deltaY * ZOOM_SPEED), fitScale() * 0.5, MAX_SCALE)
    if (next === view.scale) return
    const k = next / view.scale
    // 讓游標底下的內容點縮放前後不動
    view.tx = cx - (cx - view.tx) * k
    view.ty = cy - (cy - view.ty) * k
    view.scale = next
  }

  let lastX = 0
  let lastY = 0

  function onPointerDown(e: PointerEvent) {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    panning.value = true
    lastX = e.clientX
    lastY = e.clientY
  }

  function onPointerMove(e: PointerEvent) {
    if (!panning.value) return
    view.tx += e.clientX - lastX
    view.ty += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
  }

  function onPointerUp(e: PointerEvent) {
    if (!panning.value) return
    panning.value = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  return { view, panning, fitScale, fitToView, onWheel, onPointerDown, onPointerMove, onPointerUp }
}
