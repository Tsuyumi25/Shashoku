// Local Font Access API (Chromium 103+); lib.dom does not ship it yet.
interface FontData {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
  /** The font file's bytes, byte-for-byte as installed on disk. */
  blob(): Promise<Blob>;
}

declare function queryLocalFonts(): Promise<FontData[]>;
