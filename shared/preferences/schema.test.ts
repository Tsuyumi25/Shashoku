import { describe, expect, it } from "vitest";
import { parsePreferences, serializePreferences } from "./schema";
import {
  MIN_UNDO_PIXEL_BYTES,
  MIN_UNDO_PIXEL_STEPS,
  defaultPreferences,
} from "./types";

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
