import type { StrokePosition } from "../text-style/types";

/**
 * The renderer-facing shape of the native engine. It is not an IPC surface:
 * preload requires the addon and hands it over through contextBridge, so every
 * call is synchronous and lands in the same process as the renderer.
 *
 * Byte arrays are declared as Uint8Array rather than Buffer on purpose — the
 * addon hands back a Buffer, but contextBridge structured-clones it and the
 * renderer only ever sees a plain Uint8Array.
 *
 * Every argument has to be a plain value for the same reason. A reactive object
 * or array from a Vue store is a Proxy, which structured clone refuses, and the
 * only thing said about it is "An object could not be cloned" — no argument
 * name, no type. Copy at the call site.
 */

export interface EngineFontSource {
  /**
   * Font file on disk. The engine maps it instead of reading it, so the bytes
   * never enter the JS heap. Preferred whenever a path exists.
   */
  path?: string;
  /**
   * Raw SFNT bytes, for faces whose only handle is the Local Font Access API
   * and which therefore expose no path we can open.
   */
  bytes?: Uint8Array;
  /** Face within a .ttc / .otc collection. Defaults to 0. */
  faceIndex?: number;
  /**
   * Picks the face out of a collection by name, overriding faceIndex when it
   * matches. Required for system faces: asking one for its bytes yields the
   * whole .ttc it lives in, whose face 0 is rarely the face requested.
   */
  postscriptName?: string;
}

/**
 * No join or cap. The band is grown from the filled shape rather than swept
 * along its outline, so every corner it turns is round by construction — the
 * same reason a Photoshop layer-style stroke offers neither.
 */
export interface EngineStrokeSpec {
  /** Total stroke thickness in pixels, following the Photoshop convention. */
  width: number;
  /** "#RRGGBB" or "#RRGGBBAA". */
  color: string;
  /** Defaults to "outside". */
  position?: StrokePosition;
}

/** Where one cluster of the input string landed on a rendered bitmap. */
export interface EngineClusterRect {
  /** Byte offset of the cluster's first character in the input string. */
  cluster: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EngineBitmap {
  width: number;
  height: number;
  /**
   * Horizontal: distance from the top edge to the baseline.
   * Vertical:   distance from the left edge to the column center X.
   */
  baseline: number;
  /** RGBA bytes, length = width * height * 4. */
  rgba: Uint8Array;
  /**
   * Position of every cluster. Shaping breaks the one-to-one match between
   * characters and glyphs, so these are keyed by byte offset rather than by
   * index — which is also what makes them line up with uncoveredClusters().
   */
  clusters: EngineClusterRect[];
}

/** One face of one font file, as found on disk. */
export interface EngineFaceInfo {
  /**
   * Locale-independent family name. This is the identity a project file
   * stores, so it must not follow whoever happens to be reading.
   */
  family: string;
  /** Same family in the reader's language when the font carries one. */
  displayName: string;
  style: string;
  postscriptName: string;
  path: string;
  faceIndex: number;
}

export interface EngineEncodeInput {
  /** Bit depth is folded in: "png" | "png-8" | "jpeg" | "webp". */
  format: string;
  /** "color" | "grayscale" | "bilevel". Bilevel is PNG only. */
  colorMode: string;
  /**
   * Ceiling in bytes. Honoured only by the formats with something to turn
   * towards it — JPEG's quality, PNG-8's palette size. Nothing throws when the
   * ceiling cannot be met: the smallest attempt comes back and the caller,
   * which knows which page this was, decides what that means.
   */
  maxBytes?: number;
  /** Where a JPEG quality search starts, 1..=100. Defaults to 90. */
  quality?: number;
}

export interface ShashokuEngineApi {
  version(): string;
  /**
   * Every face under `dirs`, or under the platform's font directories when
   * omitted. `locales` orders the languages a display name is preferred in.
   *
   * The one asynchronous call on this surface: opening a thousand font files
   * belongs off the JavaScript thread.
   */
  listFonts(dirs?: string[], locales?: string[]): Promise<EngineFaceInfo[]>;
  /**
   * Byte offsets of the characters this face has no glyph for; empty means it
   * can draw the whole string. cmap lookups only — no shaping, no raster.
   */
  uncoveredClusters(font: EngineFontSource, text: string): number[];
  /**
   * `phaseX` / `phaseY` move the run inside its bitmap, in bitmap pixels,
   * before any coverage is computed. Hand over the fraction of the position
   * being drawn at and blit at its floor: the fraction then arrives as ink
   * rather than as a resample by whatever filter the surface happens to use.
   *
   * Real numbers, not steps. Rounding them to keep a bitmap cache finite is the
   * caller's constant to choose, and rounding both to zero is a rendering
   * strategy — the crisp horizontals a snapped baseline buys — rather than the
   * absence of one.
   *
   * The bitmap's size does not follow, so a phase past the blank margin around
   * the run is clipped. Anything under a pixel always fits.
   */
  renderText(
    font: EngineFontSource,
    text: string,
    sizePx: number,
    padding?: number,
    fillColor?: string,
    stroke?: EngineStrokeSpec,
    phaseX?: number,
    phaseY?: number,
  ): EngineBitmap;
  renderVertical(
    font: EngineFontSource,
    text: string,
    sizePx: number,
    padding?: number,
    fillColor?: string,
    stroke?: EngineStrokeSpec,
    phaseX?: number,
    phaseY?: number,
  ): EngineBitmap;
  /**
   * One box with an X through it per character — what there is to draw when
   * the family a text object names is not on this machine.
   *
   * Takes no font because there is none to take. It is the same shape OpenType
   * recommends for a face's own .notdef, which is deliberate: the two are the
   * same admission at different scopes, and a reader who knows one reads the
   * other.
   *
   * Takes the text, though, because the characters and the line breaks are
   * still known — breaks are stored, not measured — and they are what the grid
   * is shaped by. The grid is square and uniform on the em: every advance
   * would be a guess without a face, so this says how much text is here and
   * not how it will set.
   *
   * Distinct from a face that lacks a character. That case still renders
   * through `renderText`, marking the offsets `uncoveredClusters` reports, and
   * is a property of a chosen font rather than of the machine (see ADR 0001).
   */
  renderNotdef(
    text: string,
    sizePx: number,
    padding?: number,
    vertical?: boolean,
    fillColor?: string,
    stroke?: EngineStrokeSpec,
    phaseX?: number,
    phaseY?: number,
  ): EngineBitmap;
  /**
   * A composited page as file bytes. Takes straight RGBA because the
   * compositing happens on a canvas in the renderer — the engine never
   * decodes, it only writes what the application just drew.
   */
  encodeImage(
    rgba: Uint8Array,
    width: number,
    height: number,
    input: EngineEncodeInput,
  ): Uint8Array;
}
