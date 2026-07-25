import type { StrokePosition } from "../text-style/types";

/**
 * The renderer-facing shape of the native engine. It is not an IPC surface:
 * preload requires the addon and hands it over through contextBridge, so every
 * call is synchronous and lands in the same process as the renderer.
 *
 * Byte arrays are declared as Uint8Array rather than Buffer on purpose — the
 * addon hands back a Buffer, but contextBridge structured-clones it and the
 * renderer only ever sees a plain Uint8Array.
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

export interface EngineStrokeSpec {
  /** Total stroke thickness in pixels, following the Photoshop convention. */
  width: number;
  /** "#RRGGBB" or "#RRGGBBAA". */
  color: string;
  /** Defaults to "outside". */
  position?: StrokePosition;
  /** Defaults to "round". */
  join?: "round" | "miter" | "bevel";
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
}

export interface ShashokuEngineApi {
  version(): string;
  /** cmap-only coverage check — no shaping, no rasterization. */
  fontCovers(font: EngineFontSource, text: string): boolean;
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
