// screen ↔ content px 座標換算的唯一實作。
// 座標系:content px → screen = translate(tx,ty) ∘ scale(s) ∘ rotate(θ),
// transform-origin 0 0(與 CSS `translate() scale() rotate()` 逐項對應)。
// 所有換算都必須經過這裡——旋轉視角(PS Rotate View)加入後,任何在元件裡
// 手拼 `tx + x*scale` 的捷徑都會在旋轉下出錯。

export interface ViewTransform {
  scale: number;
  tx: number;
  ty: number;
  /** 視角旋轉(弧度)。0 = 不旋轉。 */
  rotate: number;
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
  const ix = (clientX - containerRect.left - view.tx) / view.scale;
  const iy = (clientY - containerRect.top - view.ty) / view.scale;
  if (view.rotate === 0) return { x: ix, y: iy };
  // 逆旋轉 R(-θ)
  const cos = Math.cos(view.rotate);
  const sin = Math.sin(view.rotate);
  return { x: ix * cos + iy * sin, y: -ix * sin + iy * cos };
}

/** 內容座標 px → 容器內螢幕座標(overlay 定位用)。 */
export function contentToScreenPx(
  x: number,
  y: number,
  view: ViewTransform,
): { x: number; y: number } {
  const cos = Math.cos(view.rotate);
  const sin = Math.sin(view.rotate);
  return {
    x: view.tx + view.scale * (x * cos - y * sin),
    y: view.ty + view.scale * (x * sin + y * cos),
  };
}

// ── 百分比座標(LP 血統):標籤以相對原圖寬高 ∈ [0,1] 存,換解析度不壞 ──

/** 螢幕座標(clientX/Y)→ 圖片 percent 座標 ∈ [0,1](雙擊新增、拖曳 label 用)。 */
export function screenToPercent(
  clientX: number,
  clientY: number,
  containerRect: { left: number; top: number },
  view: ViewTransform,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number } {
  const content = screenToContentPx(clientX, clientY, containerRect, view);
  return {
    x: clamp(content.x / naturalWidth, 0, 1),
    y: clamp(content.y / naturalHeight, 0, 1),
  };
}

/** percent → 圖片內容座標 px(marker 定位用;marker 活在被 transform 的容器內,不需要 view)。 */
export function percentToContentPx(
  xPercent: number,
  yPercent: number,
  naturalWidth: number,
  naturalHeight: number,
): { x: number; y: number } {
  return { x: xPercent * naturalWidth, y: yPercent * naturalHeight };
}
