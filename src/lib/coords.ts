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

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
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
 * Where a screen point sits on the page, in the fraction labels are stored as.
 * Clamped, because the page is smaller than the viewport once it is fitted:
 * the gutter around it is still the canvas, and a label dropped out there
 * could never be reached to be dragged back.
 */
export function screenToPageFraction(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number },
  view: ViewTransform,
  natural: { w: number; h: number },
): { x: number; y: number } {
  const p = screenToContentPx(clientX, clientY, containerRect, view)
  return {
    x: clamp(p.x / natural.w, 0, 1),
    y: clamp(p.y / natural.h, 0, 1),
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
 * Labels are stored as a fraction of the raw image so a project survives the
 * same page being re-scanned at another resolution. Markers live inside the
 * transformed stage, so placing one needs no view.
 */
export function percentToContentPx(
  xPercent: number,
  yPercent: number,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number } {
  return { x: xPercent * naturalWidth, y: yPercent * naturalHeight }
}
