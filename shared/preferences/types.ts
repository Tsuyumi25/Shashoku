export const MIN_FONT_PICKER_BOX_PX = 60;
export const MAX_FONT_PICKER_BOX_PX = 240;
/** Chromium's zoom steps: each one is a factor of 1.2, so ±5 is 40%–249%. */
export const MIN_UI_ZOOM_LEVEL = -5;
export const MAX_UI_ZOOM_LEVEL = 5;

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

/**
 * How far pixel history reaches, as a floor in steps and a ceiling in bytes.
 *
 * Two knobs because either alone fails in a way nobody can make sense of. A
 * pure step count answers "why is this eating three hundred megabytes"; a pure
 * byte budget answers "why can I only go back three steps". A floor that wins
 * over the ceiling means neither complaint can happen: the last few steps are
 * always there, and everything above them is bounded.
 *
 * ⚠️ Both numbers are provisional. Nothing that writes pixels in bulk exists
 * yet, so there is nothing to measure them against — the shape is what is being
 * settled here, and the values are meant to be taken again once a brush is
 * running. `UNDO_LIMIT` is deliberately not inherited as the floor: it bounds a
 * stack of closures, which is a different quantity.
 */
export const MIN_UNDO_PIXEL_STEPS = 1;
export const MIN_UNDO_PIXEL_BYTES = 16 * 1024 * 1024;

/**
 * The choice offered is the device, not the runtime: PP-OCR is an ONNX graph
 * on the processor and a torch model on the card, because no runtime won on
 * both.
 */
export type OcrDevice = "cpu" | "gpu";

export function defaultOcrPreference(): OcrPreference {
  return { device: "cpu", onomatopoeia: true };
}

/**
 * How this machine reads a page.
 *
 * ⭐ One setting rather than one per model. The recognizers are stages of a
 * single run now, not alternatives somebody picks between, so which device to
 * use is a question about the run — a per-model answer to it was always a way
 * of saying which models you meant to use, and there is nothing to say: a
 * machine with a card runs the whole trip on it.
 */
export interface OcrPreference {
  device: OcrDevice;
  /**
   * Whether the run is offered the regions a layout head calls onomatopoeia —
   * the drawn effects outside the balloons.
   *
   * ⭐ One switch for the whole group. Which reader is any good at them was
   * measured and is not a preference; whether a chapter of nothing but effects
   * is worth reading is a judgement, and making it once has to be enough.
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
  /**
   * The family a style that names none of its own is drawn in.
   *
   * ⭐ A preference and never a project field. An object that named no family
   * still names none when a collaborator opens it, and each machine answers
   * with a face it actually has — writing an answer into the file would hand
   * somebody else a name off this computer, which is the one thing storing
   * families by name is meant to prevent.
   *
   * ⚠️ Not font fallback, and the distinction is the whole of ADR 0001's last
   * section. Nothing here is consulted for an object that names a family: one
   * whose family this machine lacks still draws as boxes, because the name is
   * a fact about the project and the absence is a fact about the machine.
   * This answers the different question of what to draw when nobody has
   * chosen yet.
   *
   * Empty means the catalogue picks one. Set, it names a family, and a machine
   * without that family picks as though it were empty.
   */
  defaultFontFamily: string;
  /**
   * How tall a sample's box is in the font picker, in CSS pixels. The sample is
   * set at whatever size fills it, so this is how big the grid looks, not a size
   * the text has.
   */
  fontPickerBoxPx: number;
  /**
   * How large the whole interface is drawn, the page included, in Chromium's
   * zoom steps. 0 is as built.
   */
  uiZoomLevel: number;
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
   * The folders the library is a view of. Allowed to overlap and to nest.
   */
  workspaces: string[];
  /**
   * Projects opened, most recent first. A path only: whether it is still a
   * project is asked of the disk when the list is drawn.
   */
  recentProjects: string[];
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
  /**
   * How many pixel steps are kept whatever they weigh. The floor wins over the
   * ceiling, so this is what "you can always go back at least this far" means.
   */
  undoPixelSteps: number;
  /**
   * What pixel history may hold in memory, in bytes, above the floor.
   *
   * Memory only. Nothing on disk is swept for being over this — the old layer
   * files an edit leaves behind are collected when the project is closed or
   * next opened, which is a different question with a different answer.
   */
  undoPixelBytes: number;
  ocr: OcrPreference;
}

/**
 * A factory rather than a shared constant: the array and record inside would
 * otherwise be aliased by every caller that spreads the defaults.
 */
export function defaultPreferences(): Preferences {
  return {
    fontFavorites: [],
    fontFolders: [],
    defaultFontFamily: "",
    fontPickerBoxPx: 120,
    uiZoomLevel: 0,
    fontSampleText: "",
    fontSampleVertical: false,
    missingGlyphMode: "tofu",
    markMissingGlyphs: true,
    scanPoints: [],
    workspaces: [],
    recentProjects: [],
    panelLayout: {},
    // The reading, because a page is framed and typed before it is stacked.
    sidePanel: "labels",
    // Provisional on both counts — see MIN_UNDO_PIXEL_STEPS above. Ten steps is
    // enough to back out of a mistaken sequence; half a gigabyte is under what
    // one full-page layer at the largest page would cost twice over, so the
    // ceiling bites before the machine does.
    undoPixelSteps: 10,
    undoPixelBytes: 512 * 1024 * 1024,
    ocr: defaultOcrPreference(),
  };
}
