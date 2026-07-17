// drawElementImage 的唯一呼叫面。HTML-in-Canvas 還是實驗 API(Origin Trial,
// Intent to Ship 未排期),規格形狀可能再變——耦合收窄到這一個函數,變動只改這裡。

/**
 * 以中心錨點把標籤節點畫進 ctx 當前變換下的 doc 座標。
 *
 * 目的地尺寸 = 元素排版尺寸(doc px 語義),顯式傳給 drawElementImage——
 * 見 types/canvas.d.ts 的時序說明。
 *
 * @returns false = paint record 未就緒(節點剛掛上/剛改字),呼叫端排重試。
 */
export function drawLabelElement(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  el: HTMLElement,
  cx: number,
  cy: number,
): boolean {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (w === 0 || h === 0) return true; // 空標籤:沒有可畫的字,不算失敗
  try {
    (ctx as CanvasRenderingContext2D).drawElementImage(el, cx - w / 2, cy - h / 2, w, h);
    return true;
  } catch {
    return false;
  }
}
