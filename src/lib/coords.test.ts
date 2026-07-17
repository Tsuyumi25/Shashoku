import { describe, expect, it } from "vitest";
import { contentToScreenPx, screenToContentPx, type ViewTransform } from "./coords";

const ORIGIN = { left: 0, top: 0 };

describe("coords + 旋轉視角", () => {
  it("screenToContentPx 是 contentToScreenPx 的逆(含旋轉)", () => {
    const view: ViewTransform = { scale: 1.7, tx: 120, ty: -40, rotate: Math.PI / 7 };
    const p = { x: 333, y: 218 };
    const s = contentToScreenPx(p.x, p.y, view);
    const back = screenToContentPx(s.x, s.y, ORIGIN, view);
    expect(back.x).toBeCloseTo(p.x, 6);
    expect(back.y).toBeCloseTo(p.y, 6);
  });

  it("rotate=0 時退回純 translate+scale", () => {
    const view: ViewTransform = { scale: 2, tx: 10, ty: 20, rotate: 0 };
    expect(screenToContentPx(30, 60, ORIGIN, view)).toEqual({ x: 10, y: 20 });
    expect(contentToScreenPx(10, 20, view)).toEqual({ x: 30, y: 60 });
  });

  it("旋轉 90°:content 的 +x 軸映到 screen 的 +y 軸", () => {
    const view: ViewTransform = { scale: 1, tx: 0, ty: 0, rotate: Math.PI / 2 };
    const s = contentToScreenPx(10, 0, view);
    expect(s.x).toBeCloseTo(0, 6);
    expect(s.y).toBeCloseTo(10, 6);
  });
});
