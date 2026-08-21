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

/** A movement across the page, in page pixels, carrying no origin. */
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
 * How far the page point taken hold of at `grab` has travelled, given where the
 * pointer is now and the view as it now stands.
 *
 * A gesture holds a point on the page, not a distance on the screen. The
 * distinction is invisible while the view sits still and is the whole story
 * once it moves: a screen distance is a thing that already happened, measured
 * with the ruler of the moment it happened in, and dividing it by a scale that
 * has since changed misses by `travelled × (1/now − 1/then)` — proportional to
 * how far the drag has come, which is why it used to look like nothing on a
 * short drag and like the object being flung on a long one.
 *
 * A page point has no such problem. Zooming, panning and turning the view all
 * leave it exactly where it is, so what is grabbed stays grabbed.
 */
export function travelSinceGrab(
  grab: Anchor,
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number },
  view: ViewTransform,
): Displacement {
  const now = screenToContentPx(clientX, clientY, containerRect, view)
  return { dx: now.x - grab.x, dy: now.y - grab.y }
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
 * Where a screen point lands inside a frame placed by `centeredBoxOnScreen`, in
 * the frame's own upright pixels with the origin at its top left corner.
 *
 * The frame is drawn as a box of `box × scale` turned by `turn` about its own
 * centre, so reading a point back out is that chain run backwards: to the
 * centre, out of the turn, out of the scale, then over to the corner. What
 * comes back is in the same pixels the engine lays text out in, which is what
 * makes it the frame a caret is placed in.
 *
 * Taking the centre in client coordinates rather than a stage origin is what
 * keeps this honest under a turn: a rotated element still reports an upright
 * bounding rectangle, and the centre of that rectangle is the element's centre
 * whichever way it is lying.
 */
export function screenToFramePx(
  clientX: number,
  clientY: number,
  center: { x: number; y: number },
  box: { w: number; h: number },
  scale: number,
  turn: number,
): { x: number; y: number } {
  if (scale <= 0) return { x: 0, y: 0 }
  const out = turnedAround(NOWHERE, { x: clientX - center.x, y: clientY - center.y }, -turn)
  return { x: out.x / scale + box.w / 2, y: out.y / scale + box.h / 2 }
}

/** The inverse of `screenToFramePx`: a point of the frame, put back on screen. */
export function framePxToScreen(
  x: number,
  y: number,
  center: { x: number; y: number },
  box: { w: number; h: number },
  scale: number,
  turn: number,
): { x: number; y: number } {
  const out = turnedAround(
    NOWHERE,
    { x: (x - box.w / 2) * scale, y: (y - box.h / 2) * scale },
    turn,
  )
  return { x: center.x + out.x, y: center.y + out.y }
}

/**
 * A point turned about another, clockwise as the page's own axes run — which is
 * the direction an object's stored angle means, since Y grows downward.
 *
 * The one place the turn is written out. Everything below and every gesture
 * that swings an object around something goes through here, so a sign cannot
 * come out one way on the canvas and the other on export.
 */
export function turnedAround(
  pivot: { x: number; y: number },
  p: { x: number; y: number },
  radians: number,
): Anchor {
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos }
}

const NOWHERE = { x: 0, y: 0 }

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
  return turnedAround(
    NOWHERE,
    { x: box.w * (to.x - from.x), y: box.h * (to.y - from.y) },
    rotation,
  )
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
