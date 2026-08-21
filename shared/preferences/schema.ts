import {
  MAX_FONT_SAMPLE_PX,
  MIN_SECTION_HEIGHT,
  MIN_FONT_SAMPLE_PX,
  MIN_UNDO_PIXEL_BYTES,
  MIN_UNDO_PIXEL_STEPS,
  defaultOcrPreference,
  defaultPreferences,
  type OcrModelPreference,
  type Preferences,
} from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * A break in the font sample used to be spelled as the two characters `\` and
 * `n`, because the field holding the sample was single-line and dropped a real
 * one. That field is gone and a break is a real character now.
 *
 * Only a sample with no real break can be in the old spelling, since the writer
 * that produced it had no way to make one — so a sample saved since is never
 * touched, and a converted one stops being a candidate the moment it is saved.
 * A single-line sample meaning to hold a literal `\n` is the one thing this
 * cannot tell apart, and it is a string typed to look at a typeface.
 */
function sampleWithRealBreaks(text: string): string {
  if (text.includes("\n")) return text;
  return text.replaceAll("\\n", "\n");
}

/**
 * Never throws. Project data fails loud when damaged because silently losing
 * a translation is worse than refusing to open it; preferences are the
 * opposite — they must never keep the app from starting, so every field falls
 * back to its default on its own.
 */
export function parsePreferences(raw: string): Preferences {
  const prefs = defaultPreferences();
  if (raw.trim().length === 0) return prefs;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return prefs;
  }
  if (!isRecord(parsed)) return prefs;

  const {
    fontFavorites,
    fontFolders,
    fontSamplePx,
    fontSampleText,
    fontSampleVertical,
    missingGlyphMode,
    markMissingGlyphs,
    scanPoints,
    panelLayout,
    sidePanel,
    sectionOpen,
    sectionHeight,
    undoPixelSteps,
    undoPixelBytes,
    ocr,
  } = parsed;

  if (Array.isArray(fontFavorites)) {
    prefs.fontFavorites = fontFavorites.filter(
      (f): f is string => typeof f === "string" && f.length > 0,
    );
  }
  if (Array.isArray(fontFolders)) {
    prefs.fontFolders = fontFolders.filter(
      (f): f is string => typeof f === "string" && f.length > 0,
    );
  }
  if (typeof fontSamplePx === "number" && Number.isFinite(fontSamplePx)) {
    prefs.fontSamplePx = Math.min(
      MAX_FONT_SAMPLE_PX,
      Math.max(MIN_FONT_SAMPLE_PX, Math.round(fontSamplePx)),
    );
  }
  if (typeof fontSampleText === "string") {
    prefs.fontSampleText = sampleWithRealBreaks(fontSampleText);
  }
  if (typeof fontSampleVertical === "boolean") {
    prefs.fontSampleVertical = fontSampleVertical;
  }
  // A file written before substitute mode was dropped names it here; it fails
  // this check like any other unknown value and falls back to the default.
  if (missingGlyphMode === "hide" || missingGlyphMode === "tofu") {
    prefs.missingGlyphMode = missingGlyphMode;
  }
  if (typeof markMissingGlyphs === "boolean") {
    prefs.markMissingGlyphs = markMissingGlyphs;
  }
  if (Array.isArray(scanPoints)) {
    prefs.scanPoints = scanPoints.filter(
      (f): f is string => typeof f === "string" && f.length > 0,
    );
  }
  if (isRecord(panelLayout)) {
    for (const [key, value] of Object.entries(panelLayout)) {
      if (typeof value === "string") prefs.panelLayout[key] = value;
    }
  }
  if (sidePanel === "layers" || sidePanel === "labels") {
    prefs.sidePanel = sidePanel;
  }
  if (isRecord(sectionOpen)) {
    for (const section of ["recognizers", "source", "translation"] as const) {
      if (typeof sectionOpen[section] === "boolean") prefs.sectionOpen[section] = sectionOpen[section];
    }
  }
  if (isRecord(sectionHeight)) {
    for (const section of ["source", "translation"] as const) {
      const px = sectionHeight[section];
      if (typeof px === "number" && Number.isFinite(px)) {
        prefs.sectionHeight[section] = Math.max(MIN_SECTION_HEIGHT, px);
      }
    }
  }
  // Floored rather than range-checked at the top: a ceiling somebody wants to
  // be enormous is their business, and one small enough to hold nothing is the
  // only setting that would break undo outright.
  if (typeof undoPixelSteps === "number" && Number.isFinite(undoPixelSteps)) {
    prefs.undoPixelSteps = Math.max(MIN_UNDO_PIXEL_STEPS, Math.round(undoPixelSteps));
  }
  if (typeof undoPixelBytes === "number" && Number.isFinite(undoPixelBytes)) {
    prefs.undoPixelBytes = Math.max(MIN_UNDO_PIXEL_BYTES, Math.round(undoPixelBytes));
  }
  if (isRecord(ocr)) {
    // Both halves are read on their own. A file naming a device that no longer
    // exists still says something about the checkbox beside it, and dropping
    // the whole entry would quietly turn that back on.
    for (const [model, value] of Object.entries(ocr)) {
      if (!isRecord(value)) continue;
      const kept: Partial<OcrModelPreference> = {};
      if (value.device === "cpu" || value.device === "gpu") kept.device = value.device;
      if (typeof value.onomatopoeia === "boolean") kept.onomatopoeia = value.onomatopoeia;
      if (Object.keys(kept).length > 0) {
        prefs.ocr[model] = { ...defaultOcrPreference(), ...kept };
      }
    }
  }
  return prefs;
}

export function serializePreferences(prefs: Preferences): string {
  return JSON.stringify(
    {
      fontFavorites: prefs.fontFavorites,
      fontFolders: prefs.fontFolders,
      fontSamplePx: prefs.fontSamplePx,
      fontSampleText: prefs.fontSampleText,
      fontSampleVertical: prefs.fontSampleVertical,
      missingGlyphMode: prefs.missingGlyphMode,
      markMissingGlyphs: prefs.markMissingGlyphs,
      scanPoints: prefs.scanPoints,
      panelLayout: prefs.panelLayout,
      sidePanel: prefs.sidePanel,
      sectionOpen: prefs.sectionOpen,
      sectionHeight: prefs.sectionHeight,
      undoPixelSteps: prefs.undoPixelSteps,
      undoPixelBytes: prefs.undoPixelBytes,
      ocr: prefs.ocr,
    },
    null,
    2,
  );
}
