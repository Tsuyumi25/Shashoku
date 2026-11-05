import { describe, expect, it } from "vitest";
import { parseExportMenu, parseProfileList, serializeExportMenu } from "./schema";
import { defaultExportProfile } from "./types";

const PNG = { format: "png", colorMode: "color", size: { kind: "original" }, maxBytes: null };

function counter() {
  let n = 0;
  return () => `new-${++n}`;
}

describe("a project's export menu", () => {
  /** Told apart from an empty menu: it is the one that gets the global menu copied in. */
  it("reads a project that never had one as having none yet", () => {
    expect(parseExportMenu(undefined, counter())).toBeUndefined();
    expect(parseExportMenu([], counter())).toEqual([]);
  });

  /** Lines are told apart by id, so two with the same settings are still two lines. */
  it("keeps lines with the same settings apart", () => {
    const menu = parseExportMenu([{ ...PNG, id: "a" }, { ...PNG, id: "b" }], counter())!;
    expect(menu.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("gives a line without an id, or with one already taken, an id of its own", () => {
    const menu = parseExportMenu([PNG, { ...PNG, id: "a" }, { ...PNG, id: "a" }], counter())!;
    expect(menu.map((e) => e.id)).toEqual(["new-1", "a", "new-2"]);
  });

  it("round trips id, face, name and when each line was last delivered", () => {
    const menu = [
      {
        id: "a",
        profile: { ...defaultExportProfile(), face: "eb7c7446", name: "嵌字稿" },
        exportedAt: 1793855270376,
      },
      { id: "b", profile: { ...defaultExportProfile(), format: "jpeg" as const }, exportedAt: null },
    ];
    expect(parseExportMenu(serializeExportMenu(menu), counter())).toEqual(menu);
  });
});

describe("the global export menu", () => {
  /** A face id belongs to one book and means nothing in the next. */
  it("holds recipes without a face, and keeps their names", () => {
    const [seed] = parseProfileList([{ ...PNG, face: "a", name: "嵌字稿" }], "exportMenuSeed");
    expect(seed).not.toHaveProperty("face");
    expect(seed!.name).toBe("嵌字稿");
  });
});
