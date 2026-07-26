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
  renderText(
    font: EngineFontSource,
    text: string,
    sizePx: number,
    padding?: number,
    fillColor?: string,
    stroke?: EngineStrokeSpec,
  ): EngineBitmap;
  renderVertical(
    font: EngineFontSource,
    text: string,
    sizePx: number,
    padding?: number,
    fillColor?: string,
    stroke?: EngineStrokeSpec,
  ): EngineBitmap;
}
