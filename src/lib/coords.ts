// screen ↔ content px 座標換算的唯一實作。
// 座標系只有一層 transform:content px → screen = translate(tx,ty) 後 scale(s),
// transform-origin 0 0。所有換算都必須經過這裡。

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 螢幕座標(clientX/Y)→ 內容座標 px(未 clamp)。 */
export function screenToContentPx(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number },
  view: ViewTransform,
): { x: number; y: number } {
  return {
    x: (clientX - containerRect.left - view.tx) / view.scale,
    y: (clientY - containerRect.top - view.ty) / view.scale,
  };
}
