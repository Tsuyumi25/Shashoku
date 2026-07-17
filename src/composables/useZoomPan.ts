import { reactive, ref, toValue, type MaybeRefOrGetter } from "vue";
import { clamp, type ViewTransform } from "@/lib/coords";

export interface Size {
  w: number;
  h: number;
}

const ZOOM_SPEED = 0.0015;
const MAX_SCALE = 40;

/**
 * 兩個 mode 共用的視角變換 composable。view 是 content → container 的變換:
 * translate(tx,ty) ∘ scale ∘ rotate,transform-origin 0 0(見 lib/coords.ts)。
 * 翻譯 mode 把它套成 CSS transform,嵌字 mode 套進 ctx.setTransform——變換
 * 語義同一份,顯示手段各自選。
 *
 * onWheel 是 PS 語義:滾 = 垂直平移、Shift+滾 = 水平平移、Alt/Ctrl+滾 =
 * 縮放錨定游標(嵌字 mode 用);wheelZoom 是純游標縮放(翻譯 mode 的主滾輪,
 * LabelPlus 慣例)。pan(space+drag / 中鍵 / 背景拖曳)由呼叫端呼叫 panBy。
 */
export function useZoomPan(
  containerSize: MaybeRefOrGetter<Size>,
  contentSize: MaybeRefOrGetter<Size>,
  externalView?: ViewTransform,
) {
  // 預設每個實例自己的 view;傳入 externalView(lib/viewState 的 sharedView)
  // 則兩個 mode 共用同一份變換——切視圖繼承座標與縮放
  const view = externalView ?? reactive<ViewTransform>({ scale: 1, tx: 0, ty: 0, rotate: 0 });
  const ready = ref(false);

  function fitScale(): number {
    const container = toValue(containerSize);
    const content = toValue(contentSize);
    if (!container.w || !container.h || !content.w || !content.h) return 1;
    return Math.min(container.w / content.w, container.h / content.h);
  }

  /**
   * 適應視窗。容器或內容尺寸未就緒(display:none 的 mode 容器是 0×0)時
   * 不動 view 並回傳 false——隱藏側的自動 fit 不可污染另一側正在用的視角。
   */
  function fitToView(): boolean {
    const container = toValue(containerSize);
    const content = toValue(contentSize);
    if (!container.w || !container.h || !content.w || !content.h) return false;
    const s = fitScale();
    view.scale = s;
    view.rotate = 0;
    view.tx = (container.w - content.w * s) / 2;
    view.ty = (container.h - content.h * s) / 2;
    ready.value = true;
    return true;
  }

  /**
   * 把視角旋到 theta(弧度),保持螢幕樞軸點 (px,py) 底下的內容不動
   * (PS Rotate View 繞視窗中心旋轉的那個不變式)。
   * 推導:screen = t + s·R(θ)·c ⇒ 先解出樞軸下的內容點 c,再回推新 t。
   */
  function rotateTo(theta: number, px: number, py: number) {
    const cos1 = Math.cos(view.rotate);
    const sin1 = Math.sin(view.rotate);
    const ix = (px - view.tx) / view.scale;
    const iy = (py - view.ty) / view.scale;
    const cx = ix * cos1 + iy * sin1; // R(-θ1)·i
    const cy = -ix * sin1 + iy * cos1;

    const cos2 = Math.cos(theta);
    const sin2 = Math.sin(theta);
    view.tx = px - view.scale * (cx * cos2 - cy * sin2);
    view.ty = py - view.scale * (cx * sin2 + cy * cos2);
    view.rotate = theta;
  }

  /** 縮放到 next(clamp),保持螢幕點 (px,py) 底下的內容不動。 */
  function zoomTo(next: number, px: number, py: number) {
    const clamped = clamp(next, fitScale() * 0.5, MAX_SCALE);
    if (clamped === view.scale) return;
    const k = clamped / view.scale;
    view.tx = px - (px - view.tx) * k;
    view.ty = py - (py - view.ty) * k;
    view.scale = clamped;
  }

  /** 按倍率縮放,錨定容器中心(底部列 +/- 按鈕用)。 */
  function zoomBy(factor: number) {
    const container = toValue(containerSize);
    zoomTo(view.scale * factor, container.w / 2, container.h / 2);
  }

  /** 滾輪縮放錨定游標。翻譯 mode 的主滾輪語義;嵌字 onWheel 的 Alt/Ctrl 分支同源。 */
  function wheelZoom(e: WheelEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    zoomTo(
      view.scale * Math.exp(-e.deltaY * ZOOM_SPEED),
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  }

  function onWheel(e: WheelEvent) {
    if (e.altKey || e.ctrlKey) {
      wheelZoom(e);
      return;
    }
    // 平移:Shift 轉水平(滑鼠滾輪只有 deltaY);觸控板的 deltaX 原生支援
    if (e.shiftKey && e.deltaX === 0) {
      view.tx -= e.deltaY;
    } else {
      view.tx -= e.deltaX;
      view.ty -= e.deltaY;
    }
  }

  function panBy(dx: number, dy: number) {
    view.tx += dx;
    view.ty += dy;
  }

  return { view, ready, fitScale, fitToView, onWheel, wheelZoom, zoomBy, panBy, rotateTo };
}
