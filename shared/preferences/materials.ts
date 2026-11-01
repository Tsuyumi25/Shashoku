import { cloneEffects } from "../effects/clone";
import { parseEffects } from "../effects/schema";
import type { LayerEffect } from "../effects/types";
import { FONT_FIELDS } from "../text-style/fields";
import { parseTextStyle } from "../text-style/schema";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "../text-style/types";
import { freeGroupName } from "./fontGroups";

/**
 * Everything a material can carry, each a switch. The font is one switch for
 * the three strings that name one face, since a person picks a font, not a
 * PostScript name.
 */
export const MATERIAL_FIELDS = [
  "text",
  "font",
  "fontSizePx",
  "direction",
  "align",
  "color",
  "leadingPercent",
  "weightPx",
  "scaleXPercent",
  "scaleYPercent",
  "stroke",
] as const;

export type MaterialField = (typeof MATERIAL_FIELDS)[number];

/**
 * A whole text object taken as it stood — its words, its style, its stroke —
 * and the switches saying which of that it gives. Saving never asks what to
 * keep: everything is kept, and what is ticked is a second question that can
 * be answered later.
 */
export interface Material {
  id: string;
  /** As it reads rather than as markup. */
  text: string;
  style: TextStyle;
  effects: LayerEffect[];
  /** In `MATERIAL_FIELDS` order. */
  picks: MaterialField[];
}

/** A named shelf of materials. The groups are what the right button's ring offers. */
export interface MaterialGroup {
  id: string;
  name: string;
  materials: Material[];
}

/** Which switches a material saved this way starts with ticked. */
export interface MaterialRecipe {
  id: string;
  name: string;
  picks: MaterialField[];
}

/**
 * The two ways of saving everyone starts with: words, carried in a face that
 * reads well from the moment they land; and a look, with no words at all.
 */
export function defaultRecipes(): MaterialRecipe[] {
  return [
    { id: "text", name: "文字", picks: ["text", "font"] },
    { id: "style", name: "樣式", picks: ["font", "color", "leadingPercent", "stroke"] },
  ];
}

/** Put in canonical order with repeats and unknowns dropped, so two lists that tick the same switches read the same. */
export function normalPicks(picks: Iterable<unknown>): MaterialField[] {
  const wanted = new Set(picks);
  return MATERIAL_FIELDS.filter((f) => wanted.has(f));
}

const STYLE_KEYS: Record<Exclude<MaterialField, "text" | "stroke">, readonly (keyof TextStyle)[]> = {
  font: FONT_FIELDS,
  fontSizePx: ["fontSizePx"],
  direction: ["direction"],
  align: ["align"],
  color: ["color"],
  leadingPercent: ["leadingPercent"],
  weightPx: ["weightPx"],
  scaleXPercent: ["scaleXPercent"],
  scaleYPercent: ["scaleYPercent"],
};

/** The part of the snapshot's style that is ticked, to lay over whatever it lands on. */
export function stylePatchOf(m: Pick<Material, "style" | "picks">): Partial<TextStyle> {
  const out: Record<string, unknown> = {};
  for (const pick of m.picks) {
    if (pick === "text" || pick === "stroke") continue;
    for (const key of STYLE_KEYS[pick]) out[key] = m.style[key];
  }
  return out as Partial<TextStyle>;
}

/** The stroke to give, or null when the stroke switch is off and whatever is there stays. */
export function effectsPatchOf(m: Pick<Material, "effects" | "picks">): LayerEffect[] | null {
  return m.picks.includes("stroke") ? cloneEffects(m.effects) : null;
}

export function sameMaterial(a: Omit<Material, "id">, b: Omit<Material, "id">): boolean {
  return (
    a.text === b.text &&
    JSON.stringify(a.picks) === JSON.stringify(b.picks) &&
    JSON.stringify(a.style) === JSON.stringify(b.style) &&
    JSON.stringify(a.effects) === JSON.stringify(b.effects)
  );
}

/** What a stored entry may hold before it is read; every field still to be checked. */
type RawEntry = {
  id?: unknown;
  name?: unknown;
  text?: unknown;
  style?: unknown;
  effects?: unknown;
  picks?: unknown;
  materials?: unknown;
  texts?: unknown;
  styles?: unknown;
};

function rawEntry(v: unknown): RawEntry | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as RawEntry) : null;
}

const refuse = (message: string): never => {
  throw new Error(message);
};

/** A style a material keeps; fields it lacks are filled from the default rather than costing the entry. */
function readStyle(v: unknown): TextStyle | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  try {
    return parseTextStyle({ ...DEFAULT_TEXT_STYLE, ...v }, "style", refuse);
  } catch {
    return null;
  }
}

function readEffects(v: unknown): LayerEffect[] | null {
  try {
    return cloneEffects(parseEffects(v, "effects", refuse));
  } catch {
    return null;
  }
}

function readMaterial(raw: RawEntry): Omit<Material, "id"> | null {
  const style = raw.style === undefined ? { ...DEFAULT_TEXT_STYLE } : readStyle(raw.style);
  const effects = readEffects(raw.effects);
  if (style === null || effects === null || !Array.isArray(raw.picks)) return null;
  const text = typeof raw.text === "string" ? raw.text : "";
  return { text, style, effects, picks: normalPicks(raw.picks) };
}

/**
 * What a look gave before materials were one kind: everything but the size, the
 * direction and the alignment. Narrower than a look saved today, and kept so —
 * ticking only today's look would quietly stop an old one giving its weight and
 * its stretch.
 */
const LEGACY_LOOK_PICKS: MaterialField[] = [
  "font",
  "color",
  "leadingPercent",
  "weightPx",
  "scaleXPercent",
  "scaleYPercent",
  "stroke",
];

/**
 * The two kinds materials came in before they were one: words alone, and a
 * look with no words. Words never kept a face, so only the words are ticked —
 * ticking the font of a snapshot that never had one would hand out the blank
 * default.
 */
function readLegacy(raw: RawEntry): Omit<Material, "id">[] {
  const out: Omit<Material, "id">[] = [];
  for (const t of Array.isArray(raw.texts) ? raw.texts : []) {
    const entry = rawEntry(t);
    if (entry && typeof entry.text === "string" && entry.text.trim())
      out.push({ text: entry.text, style: { ...DEFAULT_TEXT_STYLE }, effects: [], picks: ["text"] });
  }
  for (const s of Array.isArray(raw.styles) ? raw.styles : []) {
    const entry = rawEntry(s);
    const style = entry && readStyle(entry.style);
    const effects = entry && readEffects(entry.effects);
    if (style && effects) out.push({ text: "", style, effects, picks: [...LEGACY_LOOK_PICKS] });
  }
  return out;
}

/**
 * Entries that fail to read are left out one at a time, as everything else in
 * preferences is: a damaged entry costs that entry, never the rest of the list.
 */
export function parseMaterialGroups(v: unknown): MaterialGroup[] {
  if (!Array.isArray(v)) return [];
  const out: MaterialGroup[] = [];
  const ids = new Set<string>();
  for (const entry of v) {
    const raw = rawEntry(entry);
    if (raw === null) continue;
    const { id, name } = raw;
    if (typeof id !== "string" || id.length === 0 || ids.has(id) || typeof name !== "string") continue;
    ids.add(id);
    const materials: Material[] = [];
    const seen = new Set<string>();
    const add = (mid: string, m: Omit<Material, "id">) => {
      if (seen.has(mid) || materials.some((held) => sameMaterial(held, m))) return;
      seen.add(mid);
      materials.push({ id: mid, ...m });
    };
    if (Array.isArray(raw.materials)) {
      for (const m of raw.materials) {
        const r = rawEntry(m);
        if (r === null || typeof r.id !== "string" || r.id.length === 0) continue;
        const read = readMaterial(r);
        if (read) add(r.id, read);
      }
    } else {
      readLegacy(raw).forEach((m, at) => add(`${id}-${at}`, m));
    }
    out.push({ id, name: freeGroupName(name.trim() || "未命名群組", out.map((g) => g.name)), materials });
  }
  return out;
}

/** Absent means nobody has touched them, which reads as the two everyone starts with. */
export function parseRecipes(v: unknown): MaterialRecipe[] {
  if (!Array.isArray(v)) return defaultRecipes();
  const out: MaterialRecipe[] = [];
  for (const entry of v) {
    const raw = rawEntry(entry);
    if (raw === null) continue;
    const { id, name, picks } = raw;
    if (typeof id !== "string" || id.length === 0 || out.some((r) => r.id === id)) continue;
    if (typeof name !== "string" || !Array.isArray(picks)) continue;
    out.push({ id, name: freeGroupName(name.trim() || "未命名", out.map((r) => r.name)), picks: normalPicks(picks) });
  }
  return out;
}
