import type { StrokePosition, TextAlign } from "../text-style/types";

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

/**
 * Where one cluster of the input string landed, in the unrotated space the
 * text was laid out in.
 *
 * Not bitmap coordinates once an object carries an angle: layout accumulates
 * these before the outline is turned, so they describe the run standing
 * upright however the bitmap around them ended up. That is the useful frame —
 * they answer where a caret goes and which character a click hit, both of
 * which are questions in the object's own axes — and the caller that supplied
 * the angle is the one that can turn an answer back.
 */
export interface EngineClusterRect {
  /** Byte offset of the cluster's first character in the input string. */
  cluster: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The frame a render call would come back in, without the pixels. Costs
 * shaping and outlining only — a fraction of a percent of rendering — so a
 * caller sizing a frame need not paint a bitmap it will never draw.
 */
export interface EngineMeasure {
  width: number;
  height: number;
  /**
   * Horizontal: distance from the top edge to the baseline.
   * Vertical:   distance from the left edge to the column center X.
   */
  baseline: number;
  /** Position of every cluster, as the render call would report it. */
  clusters: EngineClusterRect[];
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
  /** usWeightClass, nominally 1–1000 with 400 as regular. */
  weight: number;
  /** Width as a percentage of normal, 100 being normal. */
  width: number;
  /** Degrees away from upright; 0 is upright, italic and oblique are not. */
  slant: number;
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

/** A rectangle in page pixels. */
export interface EngineLayerFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a write to a held layer left behind. */
export interface EngineLayerPatch {
  /**
   * What to name when asking for this write to be taken back. Empty on a patch
   * that came from applying a record, since applying it again is what puts it
   * back and the caller already knows which record it asked for.
   */
  journal: string;
  /**
   * The layer's frame after the write. A write reaching past an edge moves it,
   * and the manifest has to be told.
   */
  frame: EngineLayerFrame;
  /**
   * The part of the page `rgba` describes. Equal to `frame` whenever the frame
   * moved, because a picture of the old size has nowhere to put a patch of the
   * new one — which is what keeps the caller to one paste path.
   */
  changed: EngineLayerFrame;
  /** Straight RGBA of `changed`, row-major. */
  rgba: Uint8Array;
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
   *
   * `rotation` turns the outline before any coverage is computed, in radians,
   * clockwise as the page's own axes run. Turning a finished bitmap instead
   * would resample antialiasing that is already baked in, which softens every
   * stem and cannot be filtered back; done here there is nothing to undo. The
   * bitmap grows to the rectangle that encloses the turned layout box, so an
   * angle changes the size that comes back — measure at zero to learn what the
   * object's own size is.
   *
   * `align` places a line short of the longest one inside the block, along the
   * direction the text runs. It cannot change the size that comes back: the
   * block is as wide as its longest line and that line has no slack to spend.
   */
  renderText(
    font: EngineFontSource,
    text: string,
    sizePx: number,
    padding?: number,
    rotation?: number,
    fillColor?: string,
    stroke?: EngineStrokeSpec,
    phaseX?: number,
    phaseY?: number,
    align?: TextAlign,
    weightPx?: number,
  ): EngineBitmap;
  renderVertical(
    font: EngineFontSource,
    text: string,
    sizePx: number,
    padding?: number,
    rotation?: number,
    fillColor?: string,
    stroke?: EngineStrokeSpec,
    phaseX?: number,
    phaseY?: number,
    align?: TextAlign,
    weightPx?: number,
  ): EngineBitmap;
  /**
   * The render call stopped where painting would start. Takes only the
   * arguments that shape the frame — colours, stroke and weight cannot move
   * it, though the padding sized for them can, and that stays the caller's to
   * pass.
   */
  measureText(
    font: EngineFontSource,
    text: string,
    sizePx: number,
    padding?: number,
    rotation?: number,
    phaseX?: number,
    phaseY?: number,
    align?: TextAlign,
  ): EngineMeasure;
  measureVertical(
    font: EngineFontSource,
    text: string,
    sizePx: number,
    padding?: number,
    rotation?: number,
    phaseX?: number,
    phaseY?: number,
    align?: TextAlign,
  ): EngineMeasure;
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
    rotation?: number,
    fillColor?: string,
    stroke?: EngineStrokeSpec,
    phaseX?: number,
    phaseY?: number,
    align?: TextAlign,
    weightPx?: number,
  ): EngineBitmap;
  measureNotdef(
    text: string,
    sizePx: number,
    padding?: number,
    vertical?: boolean,
    rotation?: number,
    phaseX?: number,
    phaseY?: number,
    align?: TextAlign,
  ): EngineMeasure;
  /**
   * A composited page as file bytes. Takes straight RGBA because the
   * compositing happens on a canvas in the renderer — what this writes is what
   * the application just drew, so it has nothing to decode.
   */
  encodeImage(
    rgba: Uint8Array,
    width: number,
    height: number,
    input: EngineEncodeInput,
  ): Uint8Array;

  /**
   * Hands a layer's whole pixels over, once, on its first edit.
   *
   * Whole rather than lazily and once rather than per region: the crossing is
   * about 40 ms for a full-page layer against three orders of magnitude of
   * headroom, and it buys the guarantee that the engine and the renderer never
   * hold two answers to what a layer contains. Whether the engine has taken a
   * layer over is then a moment, not something to be inferred from what
   * happened earlier.
   */
  rasterTake(id: string, rgba: Uint8Array, frame: EngineLayerFrame): void;
  rasterHolds(id: string): boolean;
  rasterRelease(id: string): void;
  /** Lets go of every held layer. Turning the page. */
  rasterReleaseAll(): void;
  /**
   * Fills the covered part of `mask` with `color` on a held layer, in one
   * transaction against its tiles.
   *
   * `mask` is A8 coverage over `maskFrame` in page pixels; `color` is
   * "#RRGGBB" or "#RRGGBBAA". Null when the coverage is empty or the colour
   * fully transparent — a write that changes nothing is not a step worth being
   * able to take back.
   */
  rasterFill(
    id: string,
    mask: Uint8Array,
    maskFrame: EngineLayerFrame,
    color: string,
  ): EngineLayerPatch | null;
  /**
   * Takes the covered part of `mask` out of a held layer, in one transaction
   * against its tiles.
   *
   * The same machinery as a fill with one operator swapped, and always all the
   * way through: an eraser that stopped at the layer below would be a second
   * kind of transparency, and there is only one. Null when the coverage is
   * empty.
   */
  rasterErase(
    id: string,
    mask: Uint8Array,
    maskFrame: EngineLayerFrame,
  ): EngineLayerPatch | null;
  /**
   * Swaps a record against its layer. Undo and redo are this same call, because
   * swapping is its own inverse. Null when the record or its layer has been let
   * go.
   */
  rasterApplyJournal(journal: string): EngineLayerPatch | null;
  /** Forgets a record — what history falling off the bottom means. */
  rasterDropJournal(journal: string): void;
  /**
   * What pixel history is holding in memory right now.
   *
   * Asked here rather than worked out from the undo stack: a block shared
   * between records looks like two from outside and is one from inside, and only
   * inside can count it right. A select-all mask is tens of thousands of
   * coordinates pointing at one block, and a caller adding up its own commands
   * would report hundreds of megabytes for four kilobytes.
   */
  rasterHistoryBytes(): number;
  /**
   * Drops the oldest records until history is under `ceiling` bytes, keeping at
   * least `floor` of them whatever they weigh, and names what it dropped.
   *
   * Call before a write, never after — building the new record first and
   * pruning afterwards is how a stack peaks at its ceiling plus a whole canvas.
   * Everything named is gone, so an undo stack has to drop those steps and
   * everything under them: history is linear, and a step whose pixels are gone
   * cannot be reached past.
   */
  rasterTrimHistory(floor: number, ceiling: number): string[];
}
