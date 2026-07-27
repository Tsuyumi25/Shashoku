import {
  CHASES_SIZE_CAP,
  COLOR_MODES_FOR,
  FILE_EXTENSION,
  type ColorMode,
  type ExportFormat,
  type ExportProfile,
  type ImageSize,
} from "./types";

/** The mode if the format can carry it, colour otherwise — every format has that. */
export function colorModeFor(format: ExportFormat, wanted: ColorMode): ColorMode {
  return COLOR_MODES_FOR[format].includes(wanted) ? wanted : "color";
}

/**
 * Changing the format drags the settings it constrains along with it, rather
 * than leaving a profile that names a combination no encoder can produce.
 */
export function withFormat(profile: ExportProfile, format: ExportFormat): ExportProfile {
  return {
    ...profile,
    format,
    colorMode: colorModeFor(format, profile.colorMode),
    maxBytes: CHASES_SIZE_CAP[format] ? profile.maxBytes : null,
  };
}

/**
 * How big the delivered page is. Never enlarged: the raw is the most detail
 * there will ever be, and scaling it up delivers a bigger file that says
 * nothing more.
 */
export function targetSize(
  page: { w: number; h: number },
  size: ImageSize,
): { w: number; h: number } {
  if (size.kind === "original") return { w: page.w, h: page.h };
  const current = size.kind === "width" ? page.w : Math.max(page.w, page.h);
  if (current <= size.px) return { w: page.w, h: page.h };
  const ratio = size.px / current;
  return {
    w: Math.max(1, Math.round(page.w * ratio)),
    h: Math.max(1, Math.round(page.h * ratio)),
  };
}

function stemOf(filename: string): string {
  const at = filename.lastIndexOf(".");
  return at <= 0 ? filename : filename.slice(0, at);
}

/** What one page is called on delivery. `index` counts the pages being exported. */
export function outputFilename(
  profile: ExportProfile,
  sourceFilename: string,
  index: number,
): string {
  const ext = FILE_EXTENSION[profile.format];
  if (profile.naming.kind === "keep") return `${stemOf(sourceFilename)}.${ext}`;
  const { prefix, suffix, padding, start } = profile.naming;
  // padStart only ever pads, so a run that outgrows its width keeps counting
  // rather than losing a digit.
  const number = String(start + index).padStart(padding, "0");
  return `${prefix}${number}${suffix}.${ext}`;
}

const FORMAT_SLUG: Record<ExportFormat, string> = {
  png: "png",
  "png-8": "png8",
  jpeg: "jpg",
  webp: "webp",
};

const COLOR_SLUG: Record<ColorMode, string> = {
  color: "color",
  grayscale: "gray",
  bilevel: "bw",
};

function sizeSlug(size: ImageSize): string {
  switch (size.kind) {
    case "original":
      return "original";
    case "width":
      return `w${size.px}`;
    case "longest-edge":
      return `e${size.px}`;
  }
}

/**
 * The folder one profile delivers into: `jpg@original`, `jpg@w1280`,
 * `png8-gray@e2048-max2048k`. What the file is on the left of the @, how big it
 * comes out on the right — the two questions someone reading a delivery folder
 * is actually asking.
 *
 * Derived from the settings rather than typed, so two profiles producing
 * different files cannot land on top of each other. The default colour mode is
 * left unsaid, which keeps the common name short without costing uniqueness:
 * the format slugs carry no hyphen, so a name either has a colour after one or
 * it is the ordinary colour.
 *
 * Held to a lowercase slug plus `@`, which every platform's file system
 * accepts — Windows reserves `< > : " / \ | ? *` and nothing here is among
 * them. A name assembled from settings has no business carrying a separator.
 *
 * Two profiles that differ only in naming rule derive the same folder, which
 * is why the profile list refuses to hold both — see assertDistinctFolders.
 */
export function profileFolderName(profile: ExportProfile): string {
  const kind =
    profile.colorMode === "color"
      ? FORMAT_SLUG[profile.format]
      : `${FORMAT_SLUG[profile.format]}-${COLOR_SLUG[profile.colorMode]}`;
  const cap = profile.maxBytes === null ? "" : `-max${Math.ceil(profile.maxBytes / 1024)}k`;
  return `${kind}@${sizeSlug(profile.size)}${cap}`;
}

export class DuplicateProfileError extends Error {}

/**
 * Two profiles writing into one folder would have the second overwrite the
 * first page for page, and the only sign would be a delivery that came out
 * looking like the other profile.
 */
export function assertDistinctFolders(profiles: readonly ExportProfile[]): void {
  const seen = new Set<string>();
  for (const profile of profiles) {
    const folder = profileFolderName(profile);
    if (seen.has(folder)) {
      throw new DuplicateProfileError(`已經有一組設定會輸出到 ${folder}/，請改動其中一組`);
    }
    seen.add(folder);
  }
}
