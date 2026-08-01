/**
 * The one place screen ↔ content px conversion lives. The view transform is
 * `translate(tx,ty) ∘ scale(s) ∘ rotate(θ)` with a `0 0` origin, matching the
 * CSS `translate() scale() rotate()` chain term for term. Anything that hand
 * rolls `tx + x * scale` breaks the moment the view is rotated.
 */
export interface ViewTransform {
  scale: number
  tx: number
  ty: number
  /** View rotation in radians. 0 means upright. */
  rotate: number
}

/** Where a text object sits, in page pixels. */
export interface Anchor {
  x: number
  y: number
}

/** A movement on screen, in screen pixels, carrying no origin. */
export interface Displacement {
  dx: number
  dy: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Put a context into page coordinates, so anything drawn at page pixel `(x, y)`
 * lands where the page's own pixel `(x, y)` is.
 *
 * Shared rather than repeated: the page and the selection over it are two
 * canvases stacked on each other, and a transform written out twice is a
 * transform that will eventually differ in one of them — which shows up as the
 * overlay sliding off the artwork the first time the view is rotated.
 *
 * Past 3x the point is to see the pixel grid, as in every other raster editor,
 * and both layers have to agree about that too or their grids will not line up.
 */
/**
 * Which filter a bitmap wants, given how many destination pixels it gets per
 * source pixel.
 *
 * Shared because a bitmap drawn at one ratio has one right answer, and the
 * canvas and the export both draw the same label bitmap. Written out twice they
 * drifted: the boundary used to be `< 1`, so a ratio of exactly 1 — 100% zoom
 * at dpr 1 — took the cheap filter on screen and the expensive one on export,
 * which is the one place a person compares the two.
 *
 * The expensive filter is a minification filter and only earns its cost going
 * down; at 1 there may still be a fractional destination to resolve, so 1
 * belongs on the paying side of the line.
 */
export function smoothingQualityFor(ratio: number): ImageSmoothingQuality {
  return ratio <= 1 ? 'high' : 'low'
}

export function applyViewTransform(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  view: ViewTransform,
  dpr: number,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.translate(view.tx, view.ty)
  ctx.scale(view.scale, view.scale)
  ctx.rotate(view.rotate)
  // Nearest neighbour past 3x, where the point is to see the pixel grid as in
  // every other raster editor. That is a property of looking at a page rather
  // than of the bitmap, so it stays here and not in the shared rule.
  ctx.imageSmoothingEnabled = view.scale < 3
  ctx.imageSmoothingQuality = smoothingQualityFor(view.scale)
}

export function screenToContentPx(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number },
  view: ViewTransform,
): { x: number; y: number } {
  const ix = (clientX - containerRect.left - view.tx) / view.scale
  const iy = (clientY - containerRect.top - view.ty) / view.scale
  if (view.rotate === 0) return { x: ix, y: iy }
  const cos = Math.cos(view.rotate)
  const sin = Math.sin(view.rotate)
  return { x: ix * cos + iy * sin, y: -ix * sin + iy * cos }
}

export function contentToScreenPx(
  x: number,
  y: number,
  view: ViewTransform,
): { x: number; y: number } {
  const cos = Math.cos(view.rotate)
  const sin = Math.sin(view.rotate)
  return {
    x: view.tx + view.scale * (x * cos - y * sin),
    y: view.ty + view.scale * (x * sin + y * cos),
  }
}

/**
 * A screen-space movement in content px. A displacement carries no origin, so
 * the translation drops out and only the scale and the rotation are undone —
 * which is what a drag needs, and why it cannot reuse the container rect that
 * screenToContentPx demands.
 */
export function screenDeltaToContentPx(
  dx: number,
  dy: number,
  view: ViewTransform,
): { x: number; y: number } {
  const ix = dx / view.scale
  const iy = dy / view.scale
  if (view.rotate === 0) return { x: ix, y: iy }
  const cos = Math.cos(view.rotate)
  const sin = Math.sin(view.rotate)
  return { x: ix * cos + iy * sin, y: -ix * sin + iy * cos }
}

/**
 * Where a screen point sits on the page, in the page pixels objects are stored
 * in. Clamped to the page, because it is smaller than the viewport once it is
 * fitted: the gutter around it is still the canvas, and a label dropped out
 * there could never be reached to be dragged back.
 */
export function screenToPagePx(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number },
  view: ViewTransform,
  natural: { w: number; h: number },
): { x: number; y: number } {
  const p = screenToContentPx(clientX, clientY, containerRect, view)
  return {
    x: clamp(p.x, 0, natural.w),
    y: clamp(p.y, 0, natural.h),
  }
}

/**
 * Screen placement of a content-sized box centred on a content point, for the
 * elements that live outside the transformed stage and carry their own pixels.
 * The box stays axis aligned: a rotated view moves its centre but never its
 * width or height, so whoever draws into it decides what to do about rotation.
 */
export function centeredBoxOnScreen(
  center: { x: number; y: number },
  size: { w: number; h: number },
  view: ViewTransform,
): { centerX: number; centerY: number; width: number; height: number } {
  const p = contentToScreenPx(center.x, center.y, view)
  return {
    centerX: p.x,
    centerY: p.y,
    width: size.w * view.scale,
    height: size.h * view.scale,
  }
}

/**
 * The page-axis vector between two fractional points of an upright frame.
 *
 * Turned with the object rather than measured in the page's axes, so a frame
 * set on a slant is walked along its own baseline.
 */
function frameOffset(
  box: { w: number; h: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
  rotation: number,
): Anchor {
  const dx = box.w * (to.x - from.x)
  const dy = box.h * (to.y - from.y)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
}

/** Where a fractional point of the object's frame lands on the page. */
export function framePoint(
  at: { x: number; y: number },
  box: { w: number; h: number },
  origin: { x: number; y: number },
  ratio: { x: number; y: number },
  rotation = 0,
): Anchor {
  const d = frameOffset(box, origin, ratio, rotation)
  return { x: at.x + d.x, y: at.y + d.y }
}

/**
 * Where the object has to stand for a fractional point of its frame to be at
 * `held` — the inverse of `framePoint`, and how a corner drag keeps the handle
 * across from it still while the size changes around it.
 *
 * Takes the size the object actually came out at rather than the ratio the
 * gesture asked for. For a text object those are different things — the size is
 * the typesetter's output, and it rounds and clamps — so predicting it would
 * put the frame where the text is not.
 */
export function positionHolding(
  held: { x: number; y: number },
  box: { w: number; h: number },
  origin: { x: number; y: number },
  ratio: { x: number; y: number },
  rotation = 0,
): Anchor {
  const d = frameOffset(box, origin, ratio, rotation)
  return { x: held.x - d.x, y: held.y - d.y }
}
