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

/** The sections of the candidate column, by what they hold. */
export type CandidateSection = "recognizers" | "source" | "translation";

/**
 * The sections whose height is dragged rather than taken from their content.
 * The recognizer section is a fixed block of buttons with nothing to scroll,
 * so a handle on it would set nothing.
 */
export type ResizableSection = "source" | "translation";

/**
 * Which sections of the candidate column are open.
 *
 * ⚠️ Sticky across objects on purpose, and this is the whole reason it is a
 * preference rather than component state: a section that folded itself away
 * when the selection changed would move everything beside it on every click,
 * and somebody who folded one away meant it to stay away.
 */
export type SectionOpen = Record<CandidateSection, boolean>;

/**
 * How tall each section of the candidate column stands, in pixels.
 *
 * ⚠️ Set rather than derived, and that is the point: a section as tall as its
 * contents is a section that changes height every time another object is
 * picked, so the section below it never sits where you last saw it. A height
 * somebody dragged holds still, and a list too long for it scrolls inside.
 */
export type SectionHeight = Record<ResizableSection, number>;

/**
 * Below this a section shows one candidate and its own scrollbar, which is no
 * section at all.
 */
export const MIN_SECTION_HEIGHT = 96;

/**
 * The choice offered is the device, not the runtime: PP-OCR is an ONNX graph
 * on the processor and a torch model on the card, because no runtime won on
 * both.
 */
export type OcrDevice = "cpu" | "gpu";

/**
 * Held per model rather than once for all of them: these are not preferences
 * about OCR, they are facts about each model that a reader is allowed to
 * disagree with.
 */
export function defaultOcrPreference(): OcrModelPreference {
  return { device: "cpu", onomatopoeia: false };
}

export interface OcrModelPreference {
  device: OcrDevice;
  /**
   * Whether this model is offered the regions a layout head calls
   * onomatopoeia — the drawn effects outside the balloons. Off for a model
   * that answers rubbish on them: an unreadable line is one more candidate to
   * rule out by hand on every object near it.
   */
  onomatopoeia: boolean;
}

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
  sectionOpen: SectionOpen;
  sectionHeight: SectionHeight;
  /**
   * Only what a reader has changed. A model absent from here has never been
   * touched and takes the default its own route declares, so this file does
   * not have to be edited every time one is added.
   */
  ocr: Record<string, OcrModelPreference>;
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
    // Both open: what was read and what it becomes are one question asked
    // twice, and folding either away is something a reader chooses, not
    // something they have to undo before the column says anything.
    sectionOpen: { recognizers: true, source: true, translation: true },
    // Room for four or five candidates each, which is what one region read by
    // every recognizer comes to.
    sectionHeight: { source: 280, translation: 220 },
    ocr: {},
  };
}
