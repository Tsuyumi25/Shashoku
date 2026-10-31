import { cloneEffects } from "../effects/clone";
import { freeGroupName } from "./fontGroups";
import { parseEffects } from "../effects/schema";
import type { LayerEffect } from "../effects/types";
import { FONT_FIELDS } from "../text-style/fields";
import { parseTextStyle } from "../text-style/schema";
import { DEFAULT_TEXT_STYLE, type TextStyle } from "../text-style/types";

/**
 * What a saved style carries. The size, the direction and the alignment stay
 * with the object it lands on: those are fitted to the place the words are
 * put, and a look reused across a chapter is reused in places of every size.
 */
export const MATERIAL_STYLE_FIELDS = [
  ...FONT_FIELDS,
  "color",
  "leadingPercent",
  "weightPx",
  "scaleXPercent",
  "scaleYPercent",
] as const satisfies readonly (keyof TextStyle)[];

export type MaterialStyle = Pick<TextStyle, (typeof MATERIAL_STYLE_FIELDS)[number]>;

/** Words kept to be set again, as they read rather than as markup. */
export interface TextMaterial {
  id: string;
  text: string;
}

/** A look kept to be given again: the style it was saved from, less what fits it to a place. */
export interface StyleMaterial {
  id: string;
  style: MaterialStyle;
  effects: LayerEffect[];
}

/**
 * A named shelf of materials — words and looks side by side, the way one corner
 * of a reference sheet holds a book's gasps in their typeface next to the gasps
 * themselves. The groups are what the right button's ring offers.
 */
export interface MaterialGroup {
  id: string;
  name: string;
  texts: TextMaterial[];
  styles: StyleMaterial[];
}

export function materialStyleOf(style: TextStyle): MaterialStyle {
  const out = {} as Record<(typeof MATERIAL_STYLE_FIELDS)[number], unknown>;
  for (const field of MATERIAL_STYLE_FIELDS) out[field] = style[field];
  return out as MaterialStyle;
}

export function sameStyleMaterial(a: Omit<StyleMaterial, "id">, b: Omit<StyleMaterial, "id">): boolean {
  return (
    MATERIAL_STYLE_FIELDS.every((f) => a.style[f] === b.style[f]) &&
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
  texts?: unknown;
  styles?: unknown;
};

function rawEntry(v: unknown): RawEntry | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as RawEntry) : null;
}

const refuse = (message: string): never => {
  throw new Error(message);
};

/**
 * Entries that fail to read are left out one at a time, as everything else in
 * preferences is: a damaged entry costs that entry, never the rest of the list.
 */
function parseTextMaterials(v: unknown): TextMaterial[] {
  if (!Array.isArray(v)) return [];
  const out: TextMaterial[] = [];
  const ids = new Set<string>();
  const texts = new Set<string>();
  for (const entry of v) {
    const raw = rawEntry(entry);
    if (raw === null) continue;
    const { id, text } = raw;
    if (typeof id !== "string" || id.length === 0 || ids.has(id)) continue;
    if (typeof text !== "string" || text.trim().length === 0 || texts.has(text)) continue;
    ids.add(id);
    texts.add(text);
    out.push({ id, text });
  }
  return out;
}

function parseStyleMaterials(v: unknown): StyleMaterial[] {
  if (!Array.isArray(v)) return [];
  const out: StyleMaterial[] = [];
  const ids = new Set<string>();
  for (const entry of v) {
    const raw = rawEntry(entry);
    if (raw === null) continue;
    const { id, style, effects } = raw;
    if (typeof id !== "string" || id.length === 0 || ids.has(id)) continue;
    if (typeof style !== "object" || style === null || Array.isArray(style)) continue;
    let material: StyleMaterial;
    try {
      // The project's own reader checks every field it shares with a style;
      // the ones a material leaves out are filled from the default to get past it.
      const full = parseTextStyle({ ...DEFAULT_TEXT_STYLE, ...style }, "style", refuse);
      material = { id, style: materialStyleOf(full), effects: cloneEffects(parseEffects(effects, "effects", refuse)) };
    } catch {
      continue;
    }
    if (out.some((m) => sameStyleMaterial(m, material))) continue;
    ids.add(id);
    out.push(material);
  }
  return out;
}

export function parseMaterialGroups(v: unknown): MaterialGroup[] {
  if (!Array.isArray(v)) return [];
  const out: MaterialGroup[] = [];
  const ids = new Set<string>();
  for (const entry of v) {
    const raw = rawEntry(entry);
    if (raw === null) continue;
    const { id, name, texts, styles } = raw;
    if (typeof id !== "string" || id.length === 0 || ids.has(id) || typeof name !== "string") continue;
    ids.add(id);
    out.push({
      id,
      name: freeGroupName(name.trim() || "未命名群組", out.map((g) => g.name)),
      texts: parseTextMaterials(texts),
      styles: parseStyleMaterials(styles),
    });
  }
  return out;
}
