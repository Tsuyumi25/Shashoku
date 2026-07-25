/**
 * Where a family's bytes come from. The two branches differ in what they can
 * hand the engine: an imported file has a path it can map, while a system face
 * is only reachable through the Local Font Access API and has to be read out
 * as bytes.
 */
export type FontOrigin =
  | {
      kind: "imported";
      path: string;
      /** Face within a .ttc / .otc collection. */
      faceIndex: number;
    }
  | {
      kind: "system";
      /** Identifies the representative face of the family. */
      postscriptName: string;
    };

export interface FontEntry {
  family: string;
  origin: FontOrigin;
}
