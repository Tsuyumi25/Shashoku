import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { context2d } from '@/lib/pageComposite'
import { isEmptyRect, sameRect, type Rect } from '@/lib/selection/rect'

/**
 * How the stroke being drawn meets the layer it is being drawn on.
 *
 * Three operators cover what a stroke can be, and each is the canvas's name for
 * what the engine will do at the release: paint, paint held to what the layer
 * already has, and take away. The layer is alone on its canvas while a stroke
 * is on it, which is what makes the last two mean *this layer* rather than
 * everything drawn beneath it.
 */
export type StrokeOverlayOp = 'source-over' | 'source-atop' | 'destination-out'

export interface StrokeOverlay {
  canvas: OffscreenCanvas
  /** Where the canvas sits, in page pixels. */
  region: Rect
  op: StrokeOverlayOp
}

/**
 * The stroke in progress, as pixels, before the engine has heard of it.
 *
 * A stroke used to be shown by asking the engine what the layer would look like
 * and pasting the answer back — a region of pixels across the addon boundary
 * per pointer event, which for a wide brush moving quickly is megabytes a
 * frame. This is the same picture arrived at without leaving the renderer: the
 * stamp lands on a canvas of its own and the stack draws it over the layer, so
 * nothing crosses until the hand comes up.
 *
 * The shape is not a second brush. Coverage is still stamped by `strokeMask`
 * into the stroke's surface, and what lands here is that coverage painted — one
 * answer to what the brush looks like, rendered twice.
 *
 * What is given up is that the blend is the canvas's rather than the engine's,
 * so an antialiased rim can differ by a step until the release replaces it.
 */
export const useStrokeOverlayStore = defineStore('strokeOverlay', () => {
  /** The layer being drawn on, which is also what has to be drawn alone. */
  const layerId = ref<string | null>(null)

  /**
   * Bumped whenever the overlay changed. The canvas is not reactive, so this is
   * what the stack watches — and it is deliberately not the raster store's, so
   * that a stroke being shown says nothing about a layer's pixels having moved.
   */
  const revision = ref(0)

  /**
   * Held by identity rather than in a plain variable: the stack reads this
   * while it renders, and growing swaps the canvas for a wider one. A change
   * nothing tracked would leave the stack drawing the canvas from before the
   * growth — which is to say, drawing nothing at all, since the first canvas of
   * a stroke is made after the press has already said which layer it is on.
   */
  const current = shallowRef<StrokeOverlay | null>(null)
  let op: StrokeOverlayOp = 'source-over'

  function begin(id: string, operator: StrokeOverlayOp): void {
    current.value = null
    op = operator
    layerId.value = id
    revision.value++
  }

  /**
   * Makes the canvas cover `region`, carrying over what it already held.
   *
   * The region is the stroke surface's, so the two grow together and a pixel's
   * place is the same in both. Growth is the surface's problem — geometric, a
   * handful of times a stroke — and this follows it.
   */
  function holding(region: Rect): void {
    const was = current.value
    if (layerId.value === null || isEmptyRect(region)) return
    if (was !== null && sameRect(was.region, region)) return
    const canvas = new OffscreenCanvas(region.w, region.h)
    if (was !== null) {
      context2d(canvas).drawImage(was.canvas, was.region.x - region.x, was.region.y - region.y)
    }
    current.value = { canvas, region: { ...region }, op }
  }

  /** Puts a segment of the stroke down, `at` in page pixels. */
  function show(image: ImageData, at: Rect): void {
    const shown = current.value
    if (shown === null) return
    context2d(shown.canvas).putImageData(image, at.x - shown.region.x, at.y - shown.region.y)
    revision.value++
  }

  /**
   * Ends the stroke. The caller commits in the same task, so the picture never
   * shows a layer that has neither the stroke nor the write.
   */
  function end(): void {
    if (current.value === null && layerId.value === null) return
    current.value = null
    layerId.value = null
    revision.value++
  }

  function overlayFor(id: string): StrokeOverlay | null {
    return layerId.value === id ? current.value : null
  }

  return { layerId, revision, begin, holding, show, end, overlayFor }
})
