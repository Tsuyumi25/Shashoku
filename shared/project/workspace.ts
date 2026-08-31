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

export interface WorkspaceScan {
  roots: string[];
  folders: ScannedFolder[];
  books: ScannedBook[];
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

export function buildWorkspaceTree(scan: WorkspaceScan): LibraryNode[] {
  const folders = new Map<string, FolderNode>();
  const declared = new Set(scan.roots);
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

  const tops: LibraryNode[] = [];
  function file(node: LibraryNode): void {
    const parent = folders.get(parentFolder(node.path));
    if (parent && parent.path !== node.path) parent.children.push(node);
    else tops.push(node);
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

  const declaredAt = new Map(scan.roots.map((root, index) => [root, index]));
  tops.sort((a, b) => {
    const byRoot =
      (declaredAt.get(a.path) ?? Number.MAX_SAFE_INTEGER) -
      (declaredAt.get(b.path) ?? Number.MAX_SAFE_INTEGER);
    return byRoot !== 0 ? byRoot : collator.compare(a.name, b.name);
  });
  for (const top of tops) countBooks(top);
  return tops;
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
