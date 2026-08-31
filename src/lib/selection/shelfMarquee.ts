import { clamp } from '@/lib/coords'
import { obbIntersectsRect } from '@/lib/selection/obb'
import type { Point, Rect } from '@/lib/selection/rect'

/** Which of the shelf's two bands a point or a drag belongs to. */
export type Territory = 'project' | 'file'

/** What `getBoundingClientRect` and `scrollTop`/`scrollLeft` give a scroller. */
export interface ScrollerFrame {
  left: number
  top: number
  scrollLeft: number
  scrollTop: number
}

/**
 * Client coordinates to content coordinates. Not compensated for scroll: the
 * same pointer position naturally reads a different content point as
 * `scrollTop` changes, which is what lets a drag keep extending while the
 * page scrolls under it without this function, or its caller, doing anything
 * about it.
 */
export function clientToContent(clientX: number, clientY: number, frame: ScrollerFrame): Point {
  return {
    x: clientX - frame.left + frame.scrollLeft,
    y: clientY - frame.top + frame.scrollTop,
  }
}

/**
 * The line between the two bands' territories, in content coordinates —
 * the midpoint of the gap between them, so the scroller has no dead strip
 * that belongs to neither. A missing band gives its side of the scroller
 * away entirely: no project band means every point is `file` territory, and
 * the reverse.
 */
export function bandBoundary(projectBottom: number | null, fileTop: number | null): number {
  if (projectBottom === null) return -Infinity
  if (fileTop === null) return Infinity
  return (projectBottom + fileTop) / 2
}

export function territoryAt(y: number, boundary: number): Territory {
  return y < boundary ? 'project' : 'file'
}

/**
 * The marquee's own geometry, cut down to the territory it started in. The
 * same rectangle is drawn and hit-tested, so a drag that reaches for the
 * other band stops flat at the line instead of sliding across it.
 */
export function clampToTerritory(rect: Rect, territory: Territory, boundary: number): Rect {
  if (territory === 'project') {
    const y1 = Math.min(boundary, rect.y + rect.h)
    return { x: rect.x, y: rect.y, w: rect.w, h: Math.max(0, y1 - rect.y) }
  }
  const y0 = Math.max(boundary, rect.y)
  return { x: rect.x, y: y0, w: rect.w, h: Math.max(0, rect.y + rect.h - y0) }
}

export interface CardBox {
  key: string
  box: Rect
}

/**
 * Which cards a marquee touches. The same criterion as `obb.ts`'s editor
 * selection — touching counts — reused rather than a second copy of it, on
 * an unrotated frame built from each card's box.
 */
export function touchedKeys(cards: readonly CardBox[], marquee: Rect): string[] {
  return cards
    .filter((card) =>
      obbIntersectsRect(
        {
          center: { x: card.box.x + card.box.w / 2, y: card.box.y + card.box.h / 2 },
          w: card.box.w,
          h: card.box.h,
          rotation: 0,
        },
        marquee,
      ),
    )
    .map((card) => card.key)
}

/**
 * What a drag's selection is this frame, from the keys touched this frame and
 * the selection standing when it began — never from what the selection was
 * last frame, so a card the box passes over, off, and back over lands
 * selected once rather than toggled twice.
 */
export function resolveFrame(
  base: readonly string[],
  hits: readonly string[],
  additive: boolean,
): string[] {
  if (!additive) return [...hits]
  return [...new Set([...base, ...hits])]
}

// ── Edge auto-scroll ────────────────────────────────────────────────────────

/**
 * The ticket's own numbers: a test zone 25% of the visible height (64–120px)
 * that grows in from the edge rather than asking the pointer to leave the
 * window, capped at half that depth, a 100ms delay before it moves at all and
 * a 300ms linear ramp to a 1000px/s top speed.
 */
export const SCROLL_ZONE_RATIO = 0.25
export const SCROLL_ZONE_MIN_PX = 64
export const SCROLL_ZONE_MAX_PX = 120
export const SCROLL_ZONE_CAP_RATIO = 0.5
export const SCROLL_DELAY_MS = 100
export const SCROLL_RAMP_MS = 300
export const SCROLL_MAX_SPEED_PX_S = 1000

/** Halfway through the 4–6px range a steady hand is not expected to cross. */
export const DRAG_THRESHOLD_PX = 5

export function scrollZoneDepth(visibleHeight: number): number {
  return clamp(visibleHeight * SCROLL_ZONE_RATIO, SCROLL_ZONE_MIN_PX, SCROLL_ZONE_MAX_PX)
}

export function edgeDistanceFactor(distanceFromEdge: number, zoneDepth: number): number {
  if (distanceFromEdge <= 0) return 1
  if (distanceFromEdge >= zoneDepth) return 0
  const capAt = zoneDepth * SCROLL_ZONE_CAP_RATIO
  return clamp((zoneDepth - distanceFromEdge) / capAt, 0, 1)
}

export function edgeTimeFactor(msInZone: number): number {
  if (msInZone <= SCROLL_DELAY_MS) return 0
  return clamp((msInZone - SCROLL_DELAY_MS) / SCROLL_RAMP_MS, 0, 1)
}

export function edgeScrollSpeed(distanceFactor: number, timeFactor: number): number {
  return SCROLL_MAX_SPEED_PX_S * distanceFactor * timeFactor
}

export type ScrollEdge = 'up' | 'down' | null

/**
 * Whether the clamped marquee is pressed against the scroller's visible top
 * or bottom. Because the marquee cannot cross into the other territory, this
 * one check already covers both of the cases scrolling has to tell apart: a
 * band taller than the viewport lets the box reach the edge and this fires,
 * a band that fits does not and it stays still.
 */
export function scrollEdgeFor(clamped: Rect, viewportTop: number, viewportBottom: number): ScrollEdge {
  if (clamped.y + clamped.h >= viewportBottom) return 'down'
  if (clamped.y <= viewportTop) return 'up'
  return null
}

export function edgeDistance(
  edge: ScrollEdge,
  clientY: number,
  viewportClientTop: number,
  viewportClientBottom: number,
): number {
  if (edge === 'down') return viewportClientBottom - clientY
  if (edge === 'up') return clientY - viewportClientTop
  return Infinity
}
