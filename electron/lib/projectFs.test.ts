import { describe, expect, it } from "vitest";
import { assertPathSegment } from "./projectFs";

describe("assertPathSegment", () => {
  it("lets an ordinary name through", () => {
    expect(() => assertPathSegment("001.png", "檔名")).not.toThrow();
    expect(() => assertPathSegment("jpg-color-w1280", "設定檔資料夾")).not.toThrow();
  });

  it("refuses a name that walks up", () => {
    expect(() => assertPathSegment("..", "檔名")).toThrow();
  });

  it("refuses a name carrying a separator", () => {
    expect(() => assertPathSegment("../../etc/passwd", "檔名")).toThrow();
    expect(() => assertPathSegment("a/b.png", "檔名")).toThrow();
    expect(() => assertPathSegment("a\\b.png", "檔名")).toThrow();
  });

  it("refuses the current folder", () => {
    expect(() => assertPathSegment(".", "設定檔資料夾")).toThrow();
  });

  it("refuses an empty name", () => {
    expect(() => assertPathSegment("", "檔名")).toThrow();
  });

  it("names what it refused, so the message can be shown", () => {
    expect(() => assertPathSegment("a/b", "檔名")).toThrow(/檔名/);
  });
});
