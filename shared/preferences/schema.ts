import {
  MAX_FONT_SAMPLE_PX,
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
    fontSamplePx,
    fontSampleText,
    missingGlyphMode,
    markMissingGlyphs,
    fontFallbackFamily,
    panelLayout,
  } = parsed;

  if (Array.isArray(fontFavorites)) {
    prefs.fontFavorites = fontFavorites.filter(
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
  if (
    missingGlyphMode === "hide" ||
    missingGlyphMode === "substitute" ||
    missingGlyphMode === "tofu"
  ) {
    prefs.missingGlyphMode = missingGlyphMode;
  }
  if (typeof markMissingGlyphs === "boolean") {
    prefs.markMissingGlyphs = markMissingGlyphs;
  }
  if (typeof fontFallbackFamily === "string") {
    prefs.fontFallbackFamily = fontFallbackFamily;
  }
  if (isRecord(panelLayout)) {
    for (const [key, value] of Object.entries(panelLayout)) {
      if (typeof value === "string") prefs.panelLayout[key] = value;
    }
  }
  return prefs;
}

export function serializePreferences(prefs: Preferences): string {
  return JSON.stringify(
    {
      fontFavorites: prefs.fontFavorites,
      fontSamplePx: prefs.fontSamplePx,
      fontSampleText: prefs.fontSampleText,
      missingGlyphMode: prefs.missingGlyphMode,
      markMissingGlyphs: prefs.markMissingGlyphs,
      fontFallbackFamily: prefs.fontFallbackFamily,
      panelLayout: prefs.panelLayout,
    },
    null,
    2,
  );
}
