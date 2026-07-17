// HTML-in-Canvas API(WICG 提案,Chromium 150+ DevTrial,flag: CanvasDrawElement)。
// lib.dom 尚未收錄,自行聲明。

declare global {
  interface CanvasRenderingContext2D {
    /**
     * 把 element「當下的渲染結果」畫進 canvas 繪製序列(x,y = 元素左上角)。
     * 元素必須是該 canvas 的 layoutsubtree 子元素,且已被渲染管線 paint 過
     * (否則 InvalidStateError: No cached paint record——等兩幀再畫)。
     *
     * width/height = canvas 座標系的目的地矩形。省略時語義是「元素在畫面上
     * 的大小換算成 canvas 座標」——依賴 CSS↔grid 比例的當幀狀態,backing
     * store 換尺寸當幀會拿到舊比例(實測 13 倍面積誤差)。一律顯式傳,
     * 免疫時序。
     */
    drawElementImage(element: Element, x: number, y: number, width?: number, height?: number): void;
  }
}

export {};
