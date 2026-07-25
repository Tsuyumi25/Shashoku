/**
 * Where a family's file came from. Both kinds are read the same way — the
 * engine maps the path itself — so the distinction only exists for what the
 * interface says about a family, not for how it gets drawn.
 */
export interface FontOrigin {
  kind: "system" | "imported";
  path: string;
  /** Face within a .ttc / .otc collection. */
  faceIndex: number;
}

export interface FontEntry {
  /**
   * Locale-independent identity. Project files store this, so it must resolve
   * to the same font for a collaborator whose language differs.
   */
  family: string;
  /** What to show a reader; falls back to `family` when the font has no
   * localized name. */
  displayName: string;
  /** Subfamily as the font names it, e.g. "Regular" or "Bold". */
  style: string;
  origin: FontOrigin;
}
