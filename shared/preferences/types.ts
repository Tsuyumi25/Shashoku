export const MIN_FONT_SAMPLE_PX = 14;
export const MAX_FONT_SAMPLE_PX = 64;

/**
 * What the picker does with a family that cannot draw the current sample.
 *
 * "hide" is the only one that removes information from the screen, which is
 * why it is not the default: a family the user never sees is one they cannot
 * know they are missing.
 */
export type MissingGlyphMode = "hide" | "substitute" | "tofu";

export interface Preferences {
  /** Font families the user starred, in the order they were added. */
  fontFavorites: string[];
  /** Sample size in the font picker grid. */
  fontSamplePx: number;
  /** Empty means the picker's first preset; the presets are localizable UI. */
  fontSampleText: string;
  missingGlyphMode: MissingGlyphMode;
  /**
   * Outlines the characters a family cannot draw. Decoupled from the mode
   * because it is worth having under both "substitute" and "tofu".
   */
  markMissingGlyphs: boolean;
  /**
   * Family that stands in under "substitute". Must name a regional variant —
   * "Noto Sans CJK" alone leaves the choice to whichever member sorts first,
   * and a Traditional Chinese project silently drawn in Japanese glyph shapes
   * is very hard to notice.
   */
  fontFallbackFamily: string;
  /**
   * Splitter geometry, one entry per group keyed by its autoSaveId. reka-ui
   * owns both the keys and the serialized values; we only provide storage.
   */
  panelLayout: Record<string, string>;
}

/**
 * A factory rather than a shared constant: the array and record inside would
 * otherwise be aliased by every caller that spreads the defaults.
 */
export function defaultPreferences(): Preferences {
  return {
    fontFavorites: [],
    fontSamplePx: 40,
    fontSampleText: "",
    missingGlyphMode: "substitute",
    markMissingGlyphs: true,
    fontFallbackFamily: "",
    panelLayout: {},
  };
}
