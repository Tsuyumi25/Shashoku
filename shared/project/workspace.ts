import { folderName, parentFolder } from "./library";

export interface ScannedCover {
  dir: string;
  file: string;
  modified: number;
  size: number;
}

export interface ScannedFolder {
  path: string;
  cover: ScannedCover | null;
}

export interface ScannedBook {
  path: string;
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
  folders: ScannedFolder[];
  books: ScannedBook[];
}

export interface WorkspaceScan {
  roots: RootScan[];
}

export interface ShelfLeaf {
  id: string;
  name: string;
  cover: ScannedCover | null;
  /** Whether it is a page of a book, as opposed to a file lying in a folder. */
  page: boolean;
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

export interface FolderContents {
  book: boolean;
  pages: ShelfLeaf[];
  entries: DirEntry[];
}

export interface BookNode {
  kind: "book";
  path: string;
  name: string;
  cover: ScannedCover | null;
  pageCount: number;
}

export interface FolderNode {
  kind: "folder";
  path: string;
  name: string;
  /** Declared by the user, as opposed to found underneath one that was. */
  workspace: boolean;
  cover: ScannedCover | null;
  children: LibraryNode[];
  /** Books anywhere below, not only the ones directly in it. */
  books: number;
}

export type LibraryNode = FolderNode | BookNode;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * One node per declared entry point, in the order they were declared.
 *
 * ⭐ An entry point is never filed under another. Declaring both `~/comics`
 * and `~/comics/2026` leaves two ways in, and the same book reached through
 * each of them is one book seen twice rather than a duplicate to resolve.
 */
export function buildWorkspaceTree(scan: WorkspaceScan): LibraryNode[] {
  const declared = new Set(scan.roots.map((each) => each.root));
  const out: LibraryNode[] = [];
  for (const each of scan.roots) {
    const node = treeFor(each, declared);
    if (node !== null) out.push(node);
  }
  return out;
}

function treeFor(scan: RootScan, declared: ReadonlySet<string>): LibraryNode | null {
  const folders = new Map<string, FolderNode>();
  for (const folder of scan.folders) {
    folders.set(folder.path, {
      kind: "folder",
      path: folder.path,
      name: folderName(folder.path),
      workspace: declared.has(folder.path),
      cover: folder.cover,
      children: [],
      books: 0,
    });
  }

  let top: LibraryNode | null = folders.get(scan.root) ?? null;
  function file(node: LibraryNode): void {
    if (node.path === scan.root) {
      top = node;
      return;
    }
    const parent = folders.get(parentFolder(node.path));
    if (parent && parent.path !== node.path) parent.children.push(node);
  }

  for (const book of scan.books) {
    file({
      kind: "book",
      path: book.path,
      name: folderName(book.path),
      cover: book.cover,
      pageCount: book.pageCount,
    });
  }
  for (const folder of scan.folders) {
    const node = folders.get(folder.path);
    if (node) file(node);
  }

  if (top === null) return null;
  countBooks(top);
  return top;
}

/**
 * How many books all the entry points reach between them, counted once each.
 * Overlapping entry points report the same book, and the shelf's own total is
 * the answer for the disk rather than the sum of what each way in sees.
 */
export function distinctBooks(scan: WorkspaceScan): number {
  const seen = new Set<string>();
  for (const each of scan.roots) for (const book of each.books) seen.add(book.path);
  return seen.size;
}

function countBooks(node: LibraryNode): number {
  if (node.kind === "book") return 1;
  node.children.sort((a, b) => collator.compare(a.name, b.name));
  node.books = node.children.reduce((total, child) => total + countBooks(child), 0);
  return node.books;
}

export function nodeAt(nodes: readonly LibraryNode[], path: string): LibraryNode | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.kind !== "folder") continue;
    const found = nodeAt(node.children, path);
    if (found) return found;
  }
  return null;
}

export function crumbsFor(
  roots: readonly string[],
  path: string,
): Array<{ name: string; path: string }> {
  const declared = new Set(roots);
  const chain: string[] = [];
  let at = path;
  for (;;) {
    chain.unshift(at);
    if (declared.has(at)) break;
    const up = parentFolder(at);
    if (up === at) break;
    at = up;
  }
  return chain.map((each) => ({ path: each, name: folderName(each) }));
}
