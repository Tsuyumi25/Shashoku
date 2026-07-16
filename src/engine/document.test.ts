import { describe, expect, it } from "vitest";
import { ShashokuDoc } from "./document";

describe("ShashokuDoc 結構操作", () => {
  it("insert/remove/move 維持 bottom→top 順序", () => {
    const doc = new ShashokuDoc(4, 4);
    const a = doc.addBlankLayer("a");
    const b = doc.addBlankLayer("b");
    doc.addBlankLayer("c");

    doc.moveLayer(0, 2);
    expect(doc.layers.map((l) => l.name)).toEqual(["b", "c", "a"]);

    const removed = doc.removeLayer(b.id)!;
    expect(removed.index).toBe(0);
    doc.insertLayer(removed.layer, removed.index);
    expect(doc.layers.map((l) => l.name)).toEqual(["b", "c", "a"]);
    expect(doc.layers[0]).toBe(removed.layer);

    expect(doc.layerIndex(a.id)).toBe(2);
    expect(doc.removeLayer("nope")).toBeNull();
  });

  it("extractAlpha 抽出 alpha channel(Ctrl+click 選區原語)", () => {
    const doc = new ShashokuDoc(3, 2);
    const layer = doc.addBlankLayer("t");
    layer.data[3] = 255; // px(0,0)
    layer.data[(1 * 3 + 2) * 4 + 3] = 128; // px(2,1)

    const alpha = doc.extractAlpha(layer.id)!;
    expect(alpha).toHaveLength(6);
    expect(alpha[0]).toBe(255);
    expect(alpha[5]).toBe(128);
    expect(alpha[1]).toBe(0);
    expect(doc.extractAlpha("nope")).toBeNull();
  });
});
