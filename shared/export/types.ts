/**
 * What one delivery looks like. A project keeps its own list and inherits from
 * nothing: a global default is a settings-page question, and answering it here
 * would mean every project silently changing when that page did.
 */

/**
 * Bit depth is folded in rather than offered separately, because outside a
 * handful of pairings it is not a free choice: PNG-8 *is* a palette, and there
 * is no such thing as a 1-bit JPEG.
 */
export type ExportFormat = "png" | "png-8" | "jpeg" | "webp";

export type ColorMode = "color" | "grayscale" | "bilevel";

/** Which color modes each format can actually carry. */
export const COLOR_MODES_FOR: Record<ExportFormat, readonly ColorMode[]> = {
  png: ["color", "grayscale", "bilevel"],
  // A 1-bit indexed PNG is a bilevel PNG by another name, so it lives there.
  "png-8": ["color", "grayscale"],
  jpeg: ["color", "grayscale"],
  webp: ["color", "grayscale"],
};

/**
 * Whether the format has anything to turn towards a byte ceiling: JPEG has
 * quality, PNG-8 has how many colours are left in the palette. Plain PNG comes
 * out at whatever its content compresses to, and WebP here is lossless — the
 * encoder behind it offers no quality parameter — so for those a ceiling is
 * something to report missing rather than to negotiate.
 */
export const CHASES_SIZE_CAP: Record<ExportFormat, boolean> = {
  png: false,
  "png-8": true,
  jpeg: true,
  webp: false,
};

export const FILE_EXTENSION: Record<ExportFormat, string> = {
  png: "png",
  "png-8": "png",
  jpeg: "jpg",
  webp: "webp",
};

export type ImageSize =
  | { kind: "original" }
  /** Neither edge past this, aspect kept. Matches how platforms state limits. */
  | { kind: "longest-edge"; px: number }
  | { kind: "width"; px: number };

/**
 * How the delivered files are named. Zero-padded counting is the default
 * because it makes natural and lexicographic order agree, which is what lets
 * the destination sort them any way it likes and still be right.
 */
export type NamingRule =
  | { kind: "keep" }
  | { kind: "sequence"; prefix: string; suffix: string; padding: number; start: number };

export interface ExportProfile {
  format: ExportFormat;
  colorMode: ColorMode;
  size: ImageSize;
  /** Ceiling per file in bytes, or null for whatever it comes out at. */
  maxBytes: number | null;
  naming: NamingRule;
}

export function defaultNamingRule(): NamingRule {
  return { kind: "sequence", prefix: "", suffix: "", padding: 3, start: 1 };
}

export function defaultExportProfile(): ExportProfile {
  return {
    format: "png",
    colorMode: "color",
    size: { kind: "original" },
    maxBytes: null,
    naming: defaultNamingRule(),
  };
}

/** Where exports go inside a project. Never the root — see the note there. */
export const DIR_EXPORT = "export";
