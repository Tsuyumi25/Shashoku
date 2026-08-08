export const MIN_FONT_SAMPLE_PX = 14;
export const MAX_FONT_SAMPLE_PX = 64;

/**
 * What the picker does with a family that cannot draw the current sample.
 *
 * "hide" removes information from the screen, which is why it is not the
 * default: a family the user never sees is one they cannot know they are
 * missing.
 */
export type MissingGlyphMode = "hide" | "tofu";

/**
 * Which of the two ways of listing a page the side column is showing: the tree,
 * whose order is stacking, or the list, whose order is reading.
 *
 * They share one column because translating and typesetting are separate trips
 * and their busy hours do not overlap — two columns of list took eighty percent
 * of the canvas between them for no moment when both were being read.
 */
export type SidePanel = "layers" | "labels";

export interface Preferences {
  /** Font families the user starred, in the order they were added. */
  fontFavorites: string[];
  /**
   * Folders scanned on top of the platform's own font directories. Files are
   * read where they lie and never copied, so a folder that moves takes its
   * families out of the catalogue with it.
   */
  fontFolders: string[];
  /** Sample size in the font picker grid. */
  fontSamplePx: number;
  /** Empty means the picker's first preset; the presets are localizable UI. */
  fontSampleText: string;
  /**
   * Only consulted when the picker opens without a style to take a direction
   * from. Opened from a style, that style decides, and toggling only lasts as
   * long as the picker stays open.
   */
  fontSampleVertical: boolean;
  missingGlyphMode: MissingGlyphMode;
  /** Outlines the characters a family cannot draw, so a box has a reason. */
  markMissingGlyphs: boolean;
  /**
   * Folders the sidebar looks under for projects. Recorded rather than
   * configured: opening a project registers its parent, so the library fills
   * itself in as it is used. Nothing here says a project exists — the sentinel
   * on disk does, every time the list is drawn.
   */
  scanPoints: string[];
  /**
   * Splitter geometry, one entry per group keyed by its autoSaveId. reka-ui
   * owns both the keys and the serialized values; we only provide storage.
   */
  panelLayout: Record<string, string>;
  /**
   * Which panel that column was left on. Kept here rather than with the
   * project because it is a property of how someone works, not of the chapter:
   * a letterer who lives in the tree wants it there in every project, and
   * re-picking it on each open would be the same click every time.
   */
  sidePanel: SidePanel;
}

/**
 * A factory rather than a shared constant: the array and record inside would
 * otherwise be aliased by every caller that spreads the defaults.
 */
export function defaultPreferences(): Preferences {
  return {
    fontFavorites: [],
    fontFolders: [],
    fontSamplePx: 40,
    fontSampleText: "",
    fontSampleVertical: false,
    missingGlyphMode: "tofu",
    markMissingGlyphs: true,
    scanPoints: [],
    panelLayout: {},
    // The reading, because a page is framed and typed before it is stacked.
    sidePanel: "labels",
  };
}
