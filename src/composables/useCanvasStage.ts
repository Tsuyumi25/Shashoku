import { inject, provide, type InjectionKey } from 'vue'
import type { ViewTransform } from '@/lib/coords'

/**
 * Where the canvas's untransformed corner is, for the overlays standing inside
 * the stage.
 *
 * ⚠️ Not the stage's own corner. The stage carries the view transform, so its
 * rectangle moves with every pan and zoom while the numbers the view speaks are
 * measured from the viewport that holds it. A gesture that read its own parent
 * would be dividing by a ruler that had already changed length.
 *
 * Passed down rather than threaded through props: every frame inside the stage
 * needs it and none of them owns it, and the intermediate components — a
 * raster frame, a text frame — have nothing to say about it.
 */
const VIEWPORT: InjectionKey<() => { left: number; top: number }> = Symbol('canvas-viewport')

const NOWHERE = () => ({ left: 0, top: 0 })

export function provideViewportOrigin(origin: () => { left: number; top: number }): void {
  provide(VIEWPORT, origin)
}

export function useViewportOrigin(): () => { left: number; top: number } {
  return inject(VIEWPORT, NOWHERE)
}

/**
 * What the stage element carries: the whole of the view, once, for everything
 * standing on it.
 *
 * ⭐ The transform is the sentence "these follow the document" written down
 * rather than performed. Every overlay used to multiply its own page
 * coordinates by the view, build its own style string and have the framework
 * write it — so one turn of the wheel was that work done again for every
 * element on screen. Now one element's transform changes and the compositor
 * does the rest.
 *
 * `--px` is how many of the stage's own units one screen pixel comes to, for
 * the few things that must not scale: an outline is a mark on the interface
 * rather than part of the document, and a handle has to stay reachable at any
 * zoom. A bare number rather than a length, so it multiplies a length —
 * `calc(8px * var(--px))` — and also stands alone in `scale()`.
 *
 * ⚠️ The stage takes no pointer of its own. It covers the whole viewport, so a
 * stage that answered would swallow every press meant for the canvas beneath
 * it; what is on it turns the pointer back on for itself.
 */
export function stageStyleFor(view: ViewTransform): Record<string, string> {
  return {
    position: 'absolute',
    inset: '0',
    transformOrigin: '0 0',
    pointerEvents: 'none',
    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale}) rotate(${view.rotate}rad)`,
    '--px': `${view.scale === 0 ? 0 : 1 / view.scale}`,
  }
}
