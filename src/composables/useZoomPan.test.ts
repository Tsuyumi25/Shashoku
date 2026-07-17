import { describe, expect, it } from "vitest";
import { contentToScreenPx, screenToContentPx } from "@/lib/coords";
import { useZoomPan } from "./useZoomPan";

const CONTAINER = { w: 800, h: 600 };
const CONTENT = { w: 400, h: 300 };

describe("useZoomPan.rotateTo", () => {
  it("樞軸不變式:旋轉前後,樞軸底下的內容點不動", () => {
    const { view, fitToView, rotateTo } = useZoomPan(
      () => CONTAINER,
      () => CONTENT,
    );
    fitToView();
    const pivot = { x: CONTAINER.w / 2, y: CONTAINER.h / 2 };
    const before = screenToContentPx(pivot.x, pivot.y, { left: 0, top: 0 }, view);

    rotateTo(Math.PI / 5, pivot.x, pivot.y);
    const after = screenToContentPx(pivot.x, pivot.y, { left: 0, top: 0 }, view);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(view.rotate).toBeCloseTo(Math.PI / 5, 9);

    // 連續旋轉同樣成立(從已旋轉狀態再旋)
    rotateTo(-Math.PI / 3, pivot.x, pivot.y);
    const again = screenToContentPx(pivot.x, pivot.y, { left: 0, top: 0 }, view);
    expect(again.x).toBeCloseTo(before.x, 6);
    expect(again.y).toBeCloseTo(before.y, 6);
  });

  it("rotateTo(0) 回正後,內容點的螢幕位置與樞軸一致", () => {
    const { view, fitToView, rotateTo } = useZoomPan(
      () => CONTAINER,
      () => CONTENT,
    );
    fitToView();
    const pivot = { x: 123, y: 456 }; // 樞軸不必是中心
    const c = screenToContentPx(pivot.x, pivot.y, { left: 0, top: 0 }, view);
    rotateTo(1.1, pivot.x, pivot.y);
    rotateTo(0, pivot.x, pivot.y);
    const s = contentToScreenPx(c.x, c.y, view);
    expect(s.x).toBeCloseTo(pivot.x, 6);
    expect(s.y).toBeCloseTo(pivot.y, 6);
    expect(view.rotate).toBe(0);
  });
});
