export interface ScannedCover {
  dir: string;
  file: string;
  modified: number;
  size: number;
}

/** A project folder as the library shows it, read where it stands. */
export interface ProjectCard {
  path: string;
  name: string;
  /** False once nothing at this path carries the sentinel. */
  found: boolean;
  /** From the sentinel; null for a project made before ids were written. */
  id: string | null;
  cover: ScannedCover | null;
  /** The ones marked deleted do not count. */
  pageCount: number;
}

/**
 * What one declared entry point answers for. Each is walked for itself, so an
 * entry point standing inside another one is scanned twice rather than folded
 * into the outer one.
 */
export interface RootScan {
  /** The declared path, resolved. */
  root: string;
  projects: ProjectCard[];
}

export interface WorkspaceScan {
  roots: RootScan[];
}

export interface DirEntry {
  name: string;
  path: string;
  folder: boolean;
  /** A directory carrying the sentinel. */
  book: boolean;
  /** Shashoku's own folder, sitting inside a book. */
  own: boolean;
  cover: ScannedCover | null;
  pageCount: number | null;
  /** Null wherever nothing walked far enough to count them. */
  books: number | null;
}
