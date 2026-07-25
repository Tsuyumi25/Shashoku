export const MIN_FONT_SAMPLE_PX = 14;
export const MAX_FONT_SAMPLE_PX = 64;

export interface Preferences {
  /** Font families the user starred, in the order they were added. */
  fontFavorites: string[];
  /** Sample size in the font picker grid. */
  fontSamplePx: number;
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
    panelLayout: {},
  };
}
