import {
  CHASES_SIZE_CAP,
  COLOR_MODES_FOR,
  defaultNamingRule,
  type ColorMode,
  type ExportFormat,
  type ExportProfile,
  type ImageSize,
  type NamingRule,
} from "./types";
import { assertDistinctFolders } from "./profile";

export class ExportProfileParseError extends Error {}

function fail(message: string): never {
  throw new ExportProfileParseError(message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const FORMATS: ExportFormat[] = ["png", "png-8", "jpeg", "webp"];

function positiveInt(v: unknown, at: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) fail(`${at} 必須是正整數`);
  return v;
}

function parseSize(v: unknown, at: string): ImageSize {
  if (v === undefined || v === null) return { kind: "original" };
  if (!isRecord(v)) fail(`${at} 必須是物件`);
  if (v.kind === "original") return { kind: "original" };
  if (v.kind === "width") return { kind: "width", px: positiveInt(v.px, `${at}.px`) };
  if (v.kind === "longest-edge")
    return { kind: "longest-edge", px: positiveInt(v.px, `${at}.px`) };
  fail(`${at}.kind 必須是 original | width | longest-edge 之一`);
}

function parseNaming(v: unknown, at: string): NamingRule {
  if (v === undefined || v === null) return defaultNamingRule();
  if (!isRecord(v)) fail(`${at} 必須是物件`);
  if (v.kind === "keep") return { kind: "keep" };
  if (v.kind !== "sequence") fail(`${at}.kind 必須是 keep | sequence 之一`);

  const { prefix, suffix, padding, start } = v;
  if (typeof prefix !== "string") fail(`${at}.prefix 必須是字串`);
  if (typeof suffix !== "string") fail(`${at}.suffix 必須是字串`);
  // These are assembled into a filename that is joined onto a path, so a
  // separator here would let the naming rule choose where a file lands.
  if (/[\\/]/.test(prefix) || /[\\/]/.test(suffix))
    fail(`${at} 的前後綴不可含路徑分隔符`);
  if (typeof padding !== "number" || !Number.isInteger(padding) || padding < 0 || padding > 12)
    fail(`${at}.padding 必須是 0 到 12 的整數`);
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0)
    fail(`${at}.start 必須是非負整數`);
  return { kind: "sequence", prefix, suffix, padding, start };
}

function parseProfile(v: unknown, i: number): ExportProfile {
  const at = `exportProfiles[${i}]`;
  if (!isRecord(v)) fail(`${at} 必須是物件`);

  const format = v.format;
  if (typeof format !== "string" || !FORMATS.includes(format as ExportFormat))
    fail(`${at}.format 必須是 ${FORMATS.join(" | ")} 之一`);
  const typedFormat = format as ExportFormat;

  const colorMode = v.colorMode;
  if (
    typeof colorMode !== "string" ||
    !COLOR_MODES_FOR[typedFormat].includes(colorMode as ColorMode)
  )
    fail(`${at}.colorMode 對 ${typedFormat} 而言必須是 ${COLOR_MODES_FOR[typedFormat].join(" | ")} 之一`);

  let maxBytes: number | null = null;
  if (v.maxBytes !== undefined && v.maxBytes !== null) {
    maxBytes = positiveInt(v.maxBytes, `${at}.maxBytes`);
    if (!CHASES_SIZE_CAP[typedFormat])
      fail(`${at}.maxBytes 對 ${typedFormat} 無效——它沒有可以往上限逼近的品質參數`);
  }

  return {
    format: typedFormat,
    colorMode: colorMode as ColorMode,
    size: parseSize(v.size, `${at}.size`),
    maxBytes,
    naming: parseNaming(v.naming, `${at}.naming`),
  };
}

/**
 * Absent means a project that predates output profiles, which is an empty list
 * rather than an error: nothing has been exported from it yet.
 */
export function parseExportProfiles(v: unknown): ExportProfile[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) fail("exportProfiles 必須是陣列");
  const profiles = v.map(parseProfile);
  assertDistinctFolders(profiles);
  return profiles;
}

export function serializeExportProfiles(profiles: readonly ExportProfile[]): unknown[] {
  return profiles.map((p) => ({
    format: p.format,
    colorMode: p.colorMode,
    size: p.size,
    maxBytes: p.maxBytes,
    naming: p.naming,
  }));
}
