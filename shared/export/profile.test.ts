import { describe, expect, it } from "vitest";
import {
  colorModeFor,
  outputFilename,
  profileFolderName,
  targetSize,
  withFormat,
} from "./profile";
import { COLOR_MODES_FOR, defaultExportProfile, type ExportProfile } from "./types";

function profile(patch: Partial<ExportProfile> = {}): ExportProfile {
  return { ...defaultExportProfile(), ...patch };
}

describe("colorModeFor", () => {
  it("keeps a mode the format can carry", () => {
    expect(colorModeFor("jpeg", "grayscale")).toBe("grayscale");
  });

  it("falls back to colour when the format cannot carry the mode", () => {
    expect(colorModeFor("jpeg", "bilevel")).toBe("color");
  });
});

describe("withFormat", () => {
  it("carries a still-valid colour mode across", () => {
    const next = withFormat(profile({ format: "png", colorMode: "grayscale" }), "jpeg");
    expect(next.colorMode).toBe("grayscale");
  });

  it("drops a colour mode the new format cannot carry", () => {
    const next = withFormat(profile({ format: "png", colorMode: "bilevel" }), "jpeg");
    expect(next.colorMode).toBe("color");
  });

  it("drops a size cap the new format cannot chase", () => {
    const next = withFormat(profile({ format: "jpeg", maxBytes: 2_000_000 }), "png");
    expect(next.maxBytes).toBeNull();
  });

  it("keeps a size cap a format with a knob can chase", () => {
    const next = withFormat(profile({ format: "jpeg", maxBytes: 2_000_000 }), "png-8");
    expect(next.maxBytes).toBe(2_000_000);
  });

  it("drops a size cap when moving to lossless WebP", () => {
    const next = withFormat(profile({ format: "jpeg", maxBytes: 2_000_000 }), "webp");
    expect(next.maxBytes).toBeNull();
  });
});

describe("targetSize", () => {
  const page = { w: 1600, h: 2400 };

  it("leaves the page alone", () => {
    expect(targetSize(page, { kind: "original" })).toEqual(page);
  });

  it("fits the longest edge and keeps the aspect", () => {
    expect(targetSize(page, { kind: "longest-edge", px: 1200 })).toEqual({ w: 800, h: 1200 });
  });

  it("does not enlarge a page already inside the longest edge", () => {
    expect(targetSize(page, { kind: "longest-edge", px: 4000 })).toEqual(page);
  });

  it("sets the width and keeps the aspect", () => {
    expect(targetSize(page, { kind: "width", px: 800 })).toEqual({ w: 800, h: 1200 });
  });

  it("does not enlarge a page already inside the width", () => {
    expect(targetSize(page, { kind: "width", px: 2000 })).toEqual(page);
  });

  it("never rounds an edge away to nothing", () => {
    expect(targetSize({ w: 2000, h: 3 }, { kind: "longest-edge", px: 100 })).toEqual({
      w: 100,
      h: 1,
    });
  });
});

describe("outputFilename", () => {
  it("counts from one with zero padding by default", () => {
    const p = profile();
    expect(outputFilename(p, "page_a.png", 0)).toBe("001.png");
    expect(outputFilename(p, "page_b.png", 9)).toBe("010.png");
  });

  it("wraps the number in whatever the rule asks for", () => {
    const p = profile({
      naming: { kind: "sequence", prefix: "ch01-", suffix: "_en", padding: 2, start: 1 },
    });
    expect(outputFilename(p, "whatever.jpg", 0)).toBe("ch01-01_en.png");
  });

  it("starts where the rule says", () => {
    const p = profile({
      naming: { kind: "sequence", prefix: "", suffix: "", padding: 3, start: 0 },
    });
    expect(outputFilename(p, "x.png", 0)).toBe("000.png");
  });

  it("outgrows its padding rather than truncating", () => {
    const p = profile({
      naming: { kind: "sequence", prefix: "", suffix: "", padding: 2, start: 1 },
    });
    expect(outputFilename(p, "x.png", 99)).toBe("100.png");
  });

  it("keeps the original stem when asked to", () => {
    const p = profile({ format: "jpeg", naming: { kind: "keep" } });
    expect(outputFilename(p, "page_007.png", 3)).toBe("page_007.jpg");
  });

  it("takes the extension from the format, not the source", () => {
    expect(outputFilename(profile({ format: "webp" }), "a.png", 0)).toBe("001.webp");
    expect(outputFilename(profile({ format: "png-8" }), "a.jpg", 0)).toBe("001.png");
  });
});

describe("profileFolderName", () => {
  it("states the format and that the size is untouched", () => {
    expect(profileFolderName(profile())).toBe("png@original");
  });

  it("states a width", () => {
    expect(profileFolderName(profile({ format: "jpeg", size: { kind: "width", px: 1280 } }))).toBe(
      "jpg@w1280",
    );
  });

  it("states a longest edge", () => {
    expect(
      profileFolderName(
        profile({ format: "png-8", colorMode: "grayscale", size: { kind: "longest-edge", px: 2048 } }),
      ),
    ).toBe("png8-gray@e2048");
  });

  it("leaves the ordinary colour mode unsaid", () => {
    expect(profileFolderName(profile({ format: "jpeg", colorMode: "color" }))).toBe(
      "jpg@original",
    );
    expect(profileFolderName(profile({ format: "png", colorMode: "bilevel" }))).toBe(
      "png-bw@original",
    );
  });

  it("states a size cap", () => {
    expect(profileFolderName(profile({ format: "jpeg", maxBytes: 2 * 1024 * 1024 }))).toBe(
      "jpg@original-max2048k",
    );
  });

  it("tells two otherwise identical profiles apart by their size", () => {
    const a = profileFolderName(profile({ format: "jpeg", size: { kind: "width", px: 1280 } }));
    const b = profileFolderName(profile({ format: "jpeg", size: { kind: "width", px: 1600 } }));
    expect(a).not.toBe(b);
  });

  it("gives every distinct set of settings a name of its own", () => {
    const names = new Set<string>();
    let count = 0;
    for (const format of ["png", "png-8", "jpeg", "webp"] as const) {
      for (const colorMode of COLOR_MODES_FOR[format]) {
        for (const size of [
          { kind: "original" } as const,
          { kind: "width", px: 1280 } as const,
          { kind: "longest-edge", px: 1280 } as const,
        ]) {
          for (const maxBytes of [null, 2 * 1024 * 1024]) {
            count++;
            names.add(profileFolderName(profile({ format, colorMode, size, maxBytes })));
          }
        }
      }
    }
    expect(names.size).toBe(count);
  });

  it("produces a name every platform's file system accepts", () => {
    for (const format of ["png", "png-8", "jpeg", "webp"] as const) {
      for (const colorMode of COLOR_MODES_FOR[format]) {
        const name = profileFolderName(profile({ format, colorMode, maxBytes: 1 }));
        // Windows reserves < > : " / \ | ? * and NUL; @ is not among them, and
        // POSIX only ever objects to / — but a name is checked, not assumed.
        expect(name).toMatch(/^[a-z0-9@-]+$/);
        expect(name).not.toMatch(/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i);
        expect(name).not.toMatch(/[ .]$/);
      }
    }
  });
});
