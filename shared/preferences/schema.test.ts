import { describe, expect, it } from "vitest";
import { parsePreferences, serializePreferences } from "./schema";
import { effectsPatchOf, stylePatchOf } from "./materials";
import { DEFAULT_TEXT_STYLE } from "../text-style/types";
import {
  MIN_UNDO_PIXEL_BYTES,
  MIN_UNDO_PIXEL_STEPS,
  defaultPreferences,
} from "./types";

describe("the family a style that names none is drawn in", () => {
  it("comes back with what was written", () => {
    const prefs = defaultPreferences();
    prefs.defaultFontFamily = "Noto Sans CJK JP";
    expect(parsePreferences(serializePreferences(prefs)).defaultFontFamily).toBe(
      "Noto Sans CJK JP",
    );
  });

  it("takes nothing from a file that says nothing about it", () => {
    expect(parsePreferences("{}").defaultFontFamily).toBe("");
  });

  /**
   * ⭐ Including one this machine has never heard of. The catalogue picks for
   * itself when it cannot find the name, and a name that means nothing here may
   * be exactly right on the machine this file came from.
   */
  it("keeps a family the machine reading the file may not have", () => {
    expect(parsePreferences('{"defaultFontFamily":"ヒラギノ角ゴ"}').defaultFontFamily).toBe(
      "ヒラギノ角ゴ",
    );
  });

  it("ignores a value that is not a string", () => {
    expect(parsePreferences('{"defaultFontFamily":42}').defaultFontFamily).toBe("");
  });
});

describe("how far pixel history reaches", () => {
  it("comes back with what was written", () => {
    const prefs = defaultPreferences();
    prefs.undoPixelSteps = 25;
    prefs.undoPixelBytes = 64 * 1024 * 1024;

    const back = parsePreferences(serializePreferences(prefs));

    expect(back.undoPixelSteps).toBe(25);
    expect(back.undoPixelBytes).toBe(64 * 1024 * 1024);
  });

  it("takes the defaults from a file that says nothing about it", () => {
    const back = parsePreferences("{}");
    expect(back.undoPixelSteps).toBe(defaultPreferences().undoPixelSteps);
    expect(back.undoPixelBytes).toBe(defaultPreferences().undoPixelBytes);
  });

  /**
   * A ceiling of zero is the one setting that would break undo outright — the
   * floor would be the only thing keeping any history at all. Floored rather
   * than refused, because preferences must never be the reason something does
   * not work.
   */
  it("will not be set low enough to hold nothing", () => {
    const back = parsePreferences(
      JSON.stringify({ undoPixelSteps: 0, undoPixelBytes: 1 }),
    );
    expect(back.undoPixelSteps).toBe(MIN_UNDO_PIXEL_STEPS);
    expect(back.undoPixelBytes).toBe(MIN_UNDO_PIXEL_BYTES);
  });

  // Nothing caps the top: somebody with the memory to spend may spend it.
  it("takes a ceiling as large as anyone cares to name", () => {
    const huge = 8 * 1024 * 1024 * 1024;
    expect(parsePreferences(JSON.stringify({ undoPixelBytes: huge })).undoPixelBytes).toBe(huge);
  });

  it("ignores a value that is not a number", () => {
    const back = parsePreferences(
      JSON.stringify({ undoPixelSteps: "lots", undoPixelBytes: null }),
    );
    expect(back.undoPixelSteps).toBe(defaultPreferences().undoPixelSteps);
    expect(back.undoPixelBytes).toBe(defaultPreferences().undoPixelBytes);
  });
});

describe("breaks in the font sample", () => {
  it("reads an escaped break written by the single-line field as a real one", () => {
    const back = parsePreferences(JSON.stringify({ fontSampleText: "上一句\\n下一句" }));
    expect(back.fontSampleText).toBe("上一句\n下一句");
  });

  // The old field could not hold a real break, so one is proof the sample has
  // been saved since — and a sample saved since is never a candidate again.
  it("leaves a sample holding a real break alone", () => {
    const kept = "上一句\n下一句\\n";
    expect(parsePreferences(JSON.stringify({ fontSampleText: kept })).fontSampleText).toBe(kept);
  });

  it("survives a round trip once converted", () => {
    const once = parsePreferences(JSON.stringify({ fontSampleText: "上一句\\n下一句" }));
    const twice = parsePreferences(serializePreferences(once));
    expect(twice.fontSampleText).toBe(once.fontSampleText);
  });
});

describe("how this machine reads a page", () => {
  it("round trips the run's own settings", () => {
    const prefs = defaultPreferences();
    prefs.ocr = { device: "gpu", onomatopoeia: false };

    expect(parsePreferences(serializePreferences(prefs)).ocr).toEqual(prefs.ocr);
  });

  /**
   * ⚠️ A file written when this was a device per model opens on the defaults.
   * There is nothing in one to carry over: what it held was which device each
   * model ran on, and the run no longer offers that choice — a machine with a
   * card runs the whole trip on it.
   */
  it("opens a file that kept a device per model on the defaults", () => {
    const older = JSON.stringify({
      ocr: { "manga-ocr": { device: "gpu" }, "ppocr-v6": { device: "cpu" } },
      ocrOnomatopoeia: false,
    });

    expect(parsePreferences(older).ocr).toEqual(defaultPreferences().ocr);
  });

  it("keeps the half of it that was written and defaults the rest", () => {
    const half = JSON.stringify({ ocr: { onomatopoeia: false } });
    expect(parsePreferences(half).ocr).toEqual({ device: "cpu", onomatopoeia: false });
  });
});

describe("the projects opened lately", () => {
  it("comes back in the order it was written, most recent first", () => {
    const prefs = defaultPreferences();
    prefs.recentProjects = ["/b/最新", "/a/older"];
    expect(parsePreferences(serializePreferences(prefs)).recentProjects).toEqual([
      "/b/最新",
      "/a/older",
    ]);
  });

  it("drops what is not a path", () => {
    const raw = JSON.stringify({ recentProjects: ["/a", 3, "", null] });
    expect(parsePreferences(raw).recentProjects).toEqual(["/a"]);
  });
});

describe("how big the font picker's boxes are", () => {
  it("comes back with what was written", () => {
    const prefs = defaultPreferences();
    prefs.fontPickerBoxPx = 180;
    expect(parsePreferences(serializePreferences(prefs)).fontPickerBoxPx).toBe(180);
  });

  /** The old field was a text size; read as a box it would be a box far too small. */
  it("opens a file that only knew the old text size on the default", () => {
    const older = JSON.stringify({ fontSamplePx: 24 });
    expect(parsePreferences(older).fontPickerBoxPx).toBe(defaultPreferences().fontPickerBoxPx);
  });
});

describe("font groups", () => {
  it("come back with what was written, in order", () => {
    const prefs = defaultPreferences();
    prefs.fontGroups = [
      { id: "a", name: "對白", families: ["Noto Sans CJK JP", "源樣黑體"] },
      { id: "b", name: "音效", families: [] },
    ];
    expect(parsePreferences(serializePreferences(prefs)).fontGroups).toEqual(prefs.fontGroups);
  });

  it("drop a group that is malformed or reuses an id", () => {
    const raw = JSON.stringify({
      fontGroups: [
        { id: "a", name: "對白", families: [] },
        { id: "a", name: "重複", families: [] },
        { id: "", name: "沒有 id", families: [] },
        { id: "c", families: [] },
        { id: "d", name: "沒有清單" },
        "not a group",
      ],
    });
    expect(parsePreferences(raw).fontGroups).toEqual([{ id: "a", name: "對白", families: [] }]);
  });

  it("never read two alike: a repeated name opens numbered", () => {
    const raw = JSON.stringify({
      fontGroups: [
        { id: "a", name: "對白", families: [] },
        { id: "b", name: "對白", families: [] },
        { id: "c", name: "對白 2", families: [] },
      ],
    });
    expect(parsePreferences(raw).fontGroups.map((g) => g.name)).toEqual(["對白", "對白 2", "對白 2 2"]);
  });

  it("give a group with a blank name one to be picked by", () => {
    const raw = JSON.stringify({ fontGroups: [{ id: "a", name: "  ", families: ["X"] }] });
    expect(parsePreferences(raw).fontGroups).toEqual([{ id: "a", name: "未命名群組", families: ["X"] }]);
  });

  it("keep a family once however often the file lists it", () => {
    const raw = JSON.stringify({
      fontGroups: [{ id: "a", name: "對白", families: ["X", "Y", "X", 3, ""] }],
    });
    expect(parsePreferences(raw).fontGroups[0]!.families).toEqual(["X", "Y"]);
  });
});

describe("materials", () => {
  const STYLE = {
    fontFamily: "HanyiSentyRubber",
    fontFace: "HanyiSentyRubber",
    fontStyleName: "Regular",
    fontSizePx: 60,
    direction: "vertical" as const,
    align: "start" as const,
    color: "#ffffff",
    leadingPercent: 120,
    weightPx: 0.5,
    scaleXPercent: 100,
    scaleYPercent: 90,
  };
  const STROKE = { kind: "stroke" as const, width: 4, color: "#000000", position: "outside" as const };
  const snap = (over: Record<string, unknown>) => ({ id: "m", text: "咕啾", style: STYLE, effects: [STROKE], picks: ["text"], ...over });

  it("come back with what was written: snapshots, switches and recipes", () => {
    const prefs = defaultPreferences();
    prefs.materialGroups = [
      {
        id: "g",
        name: "喘息",
        materials: [
          { id: "a", text: "哈\n啊", style: STYLE, effects: [STROKE], picks: ["text", "font"] },
          { id: "b", text: "", style: STYLE, effects: [], picks: ["font", "color", "stroke"] },
        ],
      },
    ];
    prefs.materialRecipes = [{ id: "r", name: "大字", picks: ["text", "fontSizePx"] }];
    const back = parsePreferences(serializePreferences(prefs));
    expect(back.materialGroups).toEqual(prefs.materialGroups);
    expect(back.materialRecipes).toEqual(prefs.materialRecipes);
  });

  it("start with a recipe for words and one for a look", () => {
    expect(parsePreferences("{}").materialRecipes.map((r) => [r.name, r.picks])).toEqual([
      ["文字", ["text", "font"]],
      ["樣式", ["font", "color", "leadingPercent", "stroke"]],
    ]);
  });

  it("keep the switches in one order and drop the ones nobody knows", () => {
    const raw = JSON.stringify({
      materialGroups: [{ id: "g", name: "x", materials: [snap({ picks: ["stroke", "glow", "text", "text"] })] }],
    });
    expect(parsePreferences(raw).materialGroups[0]!.materials[0]!.picks).toEqual(["text", "stroke"]);
  });

  it("lose only the entry that is damaged", () => {
    const raw = JSON.stringify({
      materialGroups: [
        {
          id: "g",
          name: "x",
          materials: [
            snap({ id: "a" }),
            snap({ id: "b", style: { ...STYLE, scaleXPercent: 0 } }),
            snap({ id: "c", effects: [{ kind: "glow" }] }),
            snap({ id: "d", picks: "text" }),
            snap({ id: "a", text: "嗯" }),
          ],
        },
        { id: "", name: "沒有 id" },
      ],
    });
    const groups = parsePreferences(raw).materialGroups;
    expect(groups.map((g) => g.materials.map((m) => m.id))).toEqual([["a"]]);
  });

  it("read words and looks saved before they were one kind, each ticked the way its kind is", () => {
    const raw = JSON.stringify({
      materialGroups: [
        { id: "g", name: "舊", texts: [{ id: "t", text: "哈" }], styles: [{ id: "s", style: STYLE, effects: [STROKE] }] },
      ],
    });
    const [words, look] = parsePreferences(raw).materialGroups[0]!.materials;
    expect(words).toMatchObject({ text: "哈", picks: ["text"] });
    expect(look).toMatchObject({ text: "", style: STYLE, effects: [STROKE], picks: ["font", "color", "leadingPercent", "stroke"] });
  });
});

describe("what a material gives", () => {
  const STYLE = { ...DEFAULT_TEXT_STYLE, fontFamily: "A", fontFace: "A-R", fontStyleName: "R", fontSizePx: 60, color: "#fff" };
  it("is the ticked part of its style, the font as all three of its names", () => {
    expect(stylePatchOf({ style: STYLE, picks: ["text", "font", "color"] })).toEqual({
      fontFamily: "A",
      fontFace: "A-R",
      fontStyleName: "R",
      color: "#fff",
    });
  });
  it("gives no stroke at all unless the stroke is ticked", () => {
    expect(effectsPatchOf({ effects: [], picks: ["font"] })).toBeNull();
    expect(effectsPatchOf({ effects: [], picks: ["stroke"] })).toEqual([]);
  });
});
