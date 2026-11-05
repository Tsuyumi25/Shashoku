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
 * How big the delivered page is. Never enlarged: the page's own grid is the
 * most detail there will ever be, and scaling it up delivers a bigger file that
 * says nothing more.
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
 * What a recipe produces, as a folder-name part: `jpg@original`, `jpg@w1280`,
 * `png8-gray@e2048-max2048k`. What the file is on the left of the @, how big it
 * comes out on the right — the two questions someone reading a delivery folder
 * is actually asking.
 *
 * Derived from the settings rather than typed, so two recipes producing
 * different files cannot land on top of each other. The default colour mode is
 * left unsaid, which keeps the common name short without costing uniqueness:
 * the format slugs carry no hyphen, so a name either has a colour after one or
 * it is the ordinary colour.
 *
 * Held to a lowercase slug plus `@`, which every platform's file system
 * accepts. Two recipes that differ only in naming rule derive the same part,
 * and deliver into the same folder.
 */
export function profileFolderName(profile: ExportProfile): string {
  const kind =
    profile.colorMode === "color"
      ? FORMAT_SLUG[profile.format]
      : `${FORMAT_SLUG[profile.format]}-${COLOR_SLUG[profile.colorMode]}`;
  const cap = profile.maxBytes === null ? "" : `-max${Math.ceil(profile.maxBytes / 1024)}k`;
  return `${kind}@${sizeSlug(profile.size)}${cap}`;
}

/** The folder a recipe delivers its face into: `英文-png@original`. */
export function deliveryFolderName(faceSegment: string, profile: ExportProfile): string {
  return `${faceSegment}-${profileFolderName(profile)}`;
}

/**
 * A face name as one level of a path, or null where nothing usable is left.
 * Whatever Windows refuses in a path is replaced, and its reserved device names
 * are refused whole.
 */
function folderSegment(text: string): string | null {
  const name = text
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim()
    .replace(/[. ]+$/, "");
  return name.length > 0 && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name) ? name : null;
}

export interface FaceLabel {
  id: string;
  no: number;
  name: string;
}

/**
 * The part of a delivery folder that names each face, keyed by face id.
 *
 * The face's own name, since a folder is read by people, or the face number
 * where the name leaves nothing usable. Faces whose
 * names come out alike are told apart by number, or the second would write
 * over the first page for page.
 */
export function faceFolderSegments(faces: readonly FaceLabel[]): Map<string, string> {
  const cleaned = faces.map((face) => ({ face, name: folderSegment(face.name) ?? `f${face.no}` }));
  const counts = new Map<string, number>();
  for (const { name } of cleaned) counts.set(name.toLowerCase(), (counts.get(name.toLowerCase()) ?? 0) + 1);
  return new Map(
    cleaned.map(({ face, name }) => [
      face.id,
      (counts.get(name.toLowerCase()) ?? 0) > 1 ? `f${face.no}-${name}` : name,
    ]),
  );
}
