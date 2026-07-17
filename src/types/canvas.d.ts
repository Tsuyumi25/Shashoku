// HTML-in-Canvas API(WICG 提案,Chromium 150+ DevTrial,flag: CanvasDrawElement)。
// lib.dom 尚未收錄,自行聲明。

declare global {
  interface CanvasRenderingContext2D {
    /**
     * 把 element「當下的渲染結果」畫進 canvas 繪製序列(x,y = 元素左上角)。
     * 元素必須是該 canvas 的 layoutsubtree 子元素,且已被渲染管線 paint 過
     * (否則 InvalidStateError: No cached paint record——等兩幀再畫)。
     */
    drawElementImage(element: Element, x: number, y: number): void;
  }
}

export {};
