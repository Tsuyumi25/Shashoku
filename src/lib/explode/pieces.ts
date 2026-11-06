import { applyViewTransform, type Anchor, type ViewTransform } from '@/lib/coords'

/** One region as a canvas paints it: its shape in page pixels, and the view that has pushed it out. */
export interface Piece {
  shape: Path2D
  view: ViewTransform
}

/** A view moved by a page-space travel, which turns and scales with the view. */
export function shiftedView(view: ViewTransform, by: Anchor): ViewTransform {
  if (by.x === 0 && by.y === 0) return view
  const cos = Math.cos(view.rotate)
  const sin = Math.sin(view.rotate)
  return {
    scale: view.scale,
    rotate: view.rotate,
    tx: view.tx + view.scale * (by.x * cos - by.y * sin),
    ty: view.ty + view.scale * (by.x * sin + by.y * cos),
  }
}

/**
 * Whatever `draw` paints, once per piece and kept inside that piece's shape;
 * once and uncut when the page is whole. `draw` sets its own transform from the
 * view it is handed — the clip outlasts that.
 *
 * Each canvas paints the pieces itself because a piece pushed in from beyond
 * the viewport has pixels nothing on screen holds. The pieces never overlap on
 * screen, so the clipped passes together still fill about one viewport.
 */
export function paintPieces(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  view: ViewTransform,
  pieces: readonly Piece[] | null,
  dpr: number,
  draw: (view: ViewTransform) => void,
): void {
  if (pieces === null) {
    draw(view)
    return
  }
  for (const piece of pieces) {
    ctx.save()
    applyViewTransform(ctx, piece.view, dpr)
    ctx.clip(piece.shape)
    draw(piece.view)
    ctx.restore()
  }
}
