import { freeGroupName } from "./fontGroups";
import { parseProfileList, serializeProfile } from "../export/schema";
import { parseEffects, serializeEffects } from "../effects/schema";
import { parseTextStyle, serializeTextStyle } from "../text-style/schema";
import {
  MAX_FONT_PICKER_BOX_PX,
  MAX_UI_ZOOM_LEVEL,
  MIN_FONT_PICKER_BOX_PX,
  MIN_UI_ZOOM_LEVEL,
  MIN_UNDO_PIXEL_BYTES,
  MIN_UNDO_PIXEL_STEPS,
  defaultOcrPreference,
  defaultPreferences,
  defaultRetouchOpacityPreference,
  type GlobalMaterial,
  type OcrPreference,
  type Preferences,
  type RetouchOpacityPreference,
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
    fontGroups,
    pinnedLayerSeed,
    exportMenuSeed,
    fontFolders,
    defaultFontFamily,
    fontPickerBoxPx,
    uiZoomLevel,
    activityLog,
    fontSampleText,
    fontSampleVertical,
    missingGlyphMode,
    markMissingGlyphs,
    removeEachStroke,
    wandSamplesAll,
    rulersShown,
    snapping,
    smartGuides,
    framesWhileMoving,
    scanPoints,
    workspaces,
    recentProjects,
    panelLayout,
    sidePanel,
    undoPixelSteps,
    undoPixelBytes,
    ocr,
    retouchOpacity,
    globalMaterials,
  } = parsed;

  if (Array.isArray(fontFavorites)) {
    prefs.fontFavorites = fontFavorites.filter(
      (f): f is string => typeof f === "string" && f.length > 0,
    );
  }
  if (Array.isArray(fontGroups)) {
    const ids = new Set<string>();
    for (const group of fontGroups) {
      if (!isRecord(group)) continue;
      const { id, name, families } = group;
      if (typeof id !== "string" || id.length === 0 || ids.has(id)) continue;
      if (typeof name !== "string" || !Array.isArray(families)) continue;
      ids.add(id);
      prefs.fontGroups.push({
        id,
        name: freeGroupName(name.trim() || "未命名群組", prefs.fontGroups.map((g) => g.name)),
        families: [
          ...new Set(families.filter((f): f is string => typeof f === "string" && f.length > 0)),
        ],
      });
    }
  }
  if (Array.isArray(pinnedLayerSeed)) {
    prefs.pinnedLayerSeed = [
      ...new Set(pinnedLayerSeed.filter((n): n is string => typeof n === "string" && n.length > 0)),
    ];
  }
  // A seed this build cannot read leaves the default rather than nothing: a
  // new project with an empty menu has no recipe to start from.
  if (exportMenuSeed !== undefined) {
    try {
      prefs.exportMenuSeed = parseProfileList(exportMenuSeed, "exportMenuSeed");
    } catch {
      // Kept at the default.
    }
  }
  if (Array.isArray(fontFolders)) {
    prefs.fontFolders = fontFolders.filter(
      (f): f is string => typeof f === "string" && f.length > 0,
    );
  }
  // Kept whatever it says, including a family this machine has never heard of:
  // the catalogue picks for itself when it cannot find one, and a name that
  // means nothing here may be exactly right on the machine this file syncs to.
  if (typeof defaultFontFamily === "string") {
    prefs.defaultFontFamily = defaultFontFamily;
  }
  // A file from when this was a text size (`fontSamplePx`) says nothing about
  // the box, and opens on the default.
  if (typeof fontPickerBoxPx === "number" && Number.isFinite(fontPickerBoxPx)) {
    prefs.fontPickerBoxPx = Math.min(
      MAX_FONT_PICKER_BOX_PX,
      Math.max(MIN_FONT_PICKER_BOX_PX, Math.round(fontPickerBoxPx)),
    );
  }
  if (typeof activityLog === "boolean") prefs.activityLog = activityLog;
  if (typeof uiZoomLevel === "number" && Number.isFinite(uiZoomLevel)) {
    prefs.uiZoomLevel = clampUiZoomLevel(uiZoomLevel);
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
  if (typeof removeEachStroke === "boolean") prefs.removeEachStroke = removeEachStroke;
  if (typeof wandSamplesAll === "boolean") prefs.wandSamplesAll = wandSamplesAll;
  if (typeof rulersShown === "boolean") prefs.rulersShown = rulersShown;
  if (typeof snapping === "boolean") prefs.snapping = snapping;
  if (typeof smartGuides === "boolean") prefs.smartGuides = smartGuides;
  if (typeof framesWhileMoving === "boolean") prefs.framesWhileMoving = framesWhileMoving;
  if (Array.isArray(scanPoints)) {
    prefs.scanPoints = scanPoints.filter(
      (f): f is string => typeof f === "string" && f.length > 0,
    );
  }
  if (Array.isArray(workspaces)) {
    prefs.workspaces = workspaces.filter(
      (f): f is string => typeof f === "string" && f.length > 0,
    );
  }
  if (Array.isArray(recentProjects)) {
    prefs.recentProjects = recentProjects.filter(
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
  // Floored rather than range-checked at the top: a ceiling somebody wants to
  // be enormous is their business, and one small enough to hold nothing is the
  // only setting that would break undo outright.
  if (typeof undoPixelSteps === "number" && Number.isFinite(undoPixelSteps)) {
    prefs.undoPixelSteps = Math.max(MIN_UNDO_PIXEL_STEPS, Math.round(undoPixelSteps));
  }
  if (typeof undoPixelBytes === "number" && Number.isFinite(undoPixelBytes)) {
    prefs.undoPixelBytes = Math.max(MIN_UNDO_PIXEL_BYTES, Math.round(undoPixelBytes));
  }
  // ⚠️ A file written when this was a record keyed by model opens on the
  // defaults. There is nothing in one to carry over: what it held was which
  // device each model ran on, and the run no longer offers that choice.
  if (isRecord(ocr)) {
    const kept: Partial<OcrPreference> = {};
    if (ocr.device === "cpu" || ocr.device === "gpu") kept.device = ocr.device;
    if (typeof ocr.onomatopoeia === "boolean") kept.onomatopoeia = ocr.onomatopoeia;
    prefs.ocr = { ...defaultOcrPreference(), ...kept };
  }
  if (isRecord(retouchOpacity)) {
    const kept: Partial<RetouchOpacityPreference> = {};
    if (typeof retouchOpacity.low === "number" && Number.isFinite(retouchOpacity.low)) {
      kept.low = clampOpacity(retouchOpacity.low);
    }
    if (typeof retouchOpacity.high === "number" && Number.isFinite(retouchOpacity.high)) {
      kept.high = clampOpacity(retouchOpacity.high);
    }
    if (retouchOpacity.mode === "toggle" || retouchOpacity.mode === "hold") kept.mode = retouchOpacity.mode;
    if (typeof retouchOpacity.wholeBook === "boolean") kept.wholeBook = retouchOpacity.wholeBook;
    if (typeof retouchOpacity.undoable === "boolean") kept.undoable = retouchOpacity.undoable;
    prefs.retouchOpacity = { ...defaultRetouchOpacityPreference(), ...kept };
  }
  if (Array.isArray(globalMaterials)) prefs.globalMaterials = parseGlobalMaterials(globalMaterials);
  return prefs;
}

/** Thrown by a material that no longer reads, and caught for that one alone. */
class UnreadableMaterial extends Error {}

/** Each one on its own: one that no longer reads is dropped and the rest are kept. */
function parseGlobalMaterials(list: unknown[]): GlobalMaterial[] {
  const fail = (message: string): never => {
    throw new UnreadableMaterial(message);
  };
  const ids = new Set<string>();
  const kept: GlobalMaterial[] = [];
  for (const [i, item] of list.entries()) {
    if (!isRecord(item)) continue;
    const { id, code, style, effects } = item;
    if (typeof id !== "string" || id.length === 0 || ids.has(id) || typeof code !== "string") continue;
    try {
      kept.push({
        id,
        code,
        style: parseTextStyle(style, `globalMaterials[${i}].style`, fail),
        effects: parseEffects(effects, `globalMaterials[${i}].effects`, fail),
      });
      ids.add(id);
    } catch (err) {
      if (!(err instanceof UnreadableMaterial)) throw err;
    }
  }
  return kept;
}

export function clampOpacity(opacity: number): number {
  return Math.min(1, Math.max(0, opacity));
}

export function clampUiZoomLevel(level: number): number {
  return Math.min(MAX_UI_ZOOM_LEVEL, Math.max(MIN_UI_ZOOM_LEVEL, Math.round(level)));
}

export function serializePreferences(prefs: Preferences): string {
  return JSON.stringify(
    {
      fontFavorites: prefs.fontFavorites,
      fontGroups: prefs.fontGroups,
      pinnedLayerSeed: prefs.pinnedLayerSeed,
      exportMenuSeed: prefs.exportMenuSeed.map(serializeProfile),
      fontFolders: prefs.fontFolders,
      defaultFontFamily: prefs.defaultFontFamily,
      fontPickerBoxPx: prefs.fontPickerBoxPx,
      uiZoomLevel: prefs.uiZoomLevel,
      activityLog: prefs.activityLog,
      fontSampleText: prefs.fontSampleText,
      fontSampleVertical: prefs.fontSampleVertical,
      missingGlyphMode: prefs.missingGlyphMode,
      markMissingGlyphs: prefs.markMissingGlyphs,
      removeEachStroke: prefs.removeEachStroke,
      wandSamplesAll: prefs.wandSamplesAll,
      rulersShown: prefs.rulersShown,
      snapping: prefs.snapping,
      smartGuides: prefs.smartGuides,
      framesWhileMoving: prefs.framesWhileMoving,
      scanPoints: prefs.scanPoints,
      workspaces: prefs.workspaces,
      recentProjects: prefs.recentProjects,
      panelLayout: prefs.panelLayout,
      sidePanel: prefs.sidePanel,
      undoPixelSteps: prefs.undoPixelSteps,
      undoPixelBytes: prefs.undoPixelBytes,
      ocr: prefs.ocr,
      retouchOpacity: prefs.retouchOpacity,
      globalMaterials: prefs.globalMaterials.map((m) => ({
        id: m.id,
        code: m.code,
        style: serializeTextStyle(m.style),
        effects: serializeEffects(m.effects),
      })),
    },
    null,
    2,
  );
}
