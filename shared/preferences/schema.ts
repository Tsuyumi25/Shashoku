import {
  MAX_FONT_SAMPLE_PX,
  MIN_SECTION_HEIGHT,
  MIN_FONT_SAMPLE_PX,
  defaultPreferences,
  type Preferences,
} from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
    prefs.fontSampleText = fontSampleText;
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
    for (const section of ["source", "translation"] as const) {
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
    },
    null,
    2,
  );
}
