import { reactive, ref, toValue, type MaybeRefOrGetter } from "vue";
import { clamp, type ViewTransform } from "@/lib/coords";

export interface Size {
  w: number;
  h: number;
}

const ZOOM_SPEED = 0.0015;
const MAX_SCALE = 40;

/**
 * CSS transform 型 zoom/pan(搬自 YALP)。view 是 content → container 的變換:
 * 先 translate(tx,ty) 再 scale,transform-origin 0 0。
 *
 * 滾輪走 PS 語義:滾 = 垂直平移、Shift+滾 = 水平平移、Alt+滾 = 縮放(錨定
 * 游標);Ctrl+滾也縮放(觸控板 pinch 在 Chromium 送出的形態)。
 * pan(space+drag / 中鍵)由呼叫端在需要時呼叫 panBy。
 */
export function useZoomPan(
  containerSize: MaybeRefOrGetter<Size>,
  contentSize: MaybeRefOrGetter<Size>,
) {
  const view = reactive<ViewTransform>({ scale: 1, tx: 0, ty: 0, rotate: 0 });
  const ready = ref(false);

  function fitScale(): number {
    const container = toValue(containerSize);
    const content = toValue(contentSize);
    if (!container.w || !container.h || !content.w || !content.h) return 1;
    return Math.min(container.w / content.w, container.h / content.h);
  }

  function fitToView() {
    const container = toValue(containerSize);
    const content = toValue(contentSize);
    const s = fitScale();
    view.scale = s;
    view.rotate = 0;
    view.tx = (container.w - content.w * s) / 2;
    view.ty = (container.h - content.h * s) / 2;
    ready.value = true;
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

  function onWheel(e: WheelEvent) {
    if (e.altKey || e.ctrlKey) {
      // 縮放,錨定游標(游標底下的內容點縮放前後不動)
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const next = clamp(
        view.scale * Math.exp(-e.deltaY * ZOOM_SPEED),
        fitScale() * 0.5,
        MAX_SCALE,
      );
      if (next === view.scale) return;
      const k = next / view.scale;
      view.tx = cx - (cx - view.tx) * k;
      view.ty = cy - (cy - view.ty) * k;
      view.scale = next;
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

  return { view, ready, fitScale, fitToView, onWheel, panBy, rotateTo };
}
