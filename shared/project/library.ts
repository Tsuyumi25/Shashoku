/**
 * The library is derived, never configured. Opening a project records its
 * parent folder as a scan point; what the sidebar shows is whatever carries a
 * sentinel underneath those folders today — pages that were never opened
 * included, and pages that have since been moved away excluded.
 */

/** One scan point as the file system currently answers for it. */
export interface ScannedScanPoint {
  /** The recorded folder itself. */
  path: string;
  /** Its immediate children that carry a sentinel. */
  projects: ScannedProject[];
}

export interface ScannedProject {
  path: string;
  /** First image by natural order, or null when the project holds none. */
  cover: string | null;
}

export interface LibraryProject {
  path: string;
  name: string;
  cover: string | null;
}

export type LibraryEntry =
  | ({ kind: "project" } & LibraryProject)
  | { kind: "series"; path: string; name: string; projects: LibraryProject[] };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The last segment of a path. Both separators are honoured because these paths
 * are produced by the platform and compared here, where the platform is not
 * known.
 */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const last = at === -1 ? trimmed : trimmed.slice(at + 1);
  return last.length > 0 ? last : path;
}

/**
 * The folder a project is filed under, which is what gets recorded as a scan
 * point. A path with nowhere left to go up answers itself, so a project opened
 * at a filesystem root scans that root rather than nothing.
 */
export function parentFolder(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (at === -1) return trimmed;
  return at === 0 ? trimmed.slice(0, 1) : trimmed.slice(0, at);
}

function toProject(scanned: ScannedProject): LibraryProject {
  return { path: scanned.path, name: folderName(scanned.path), cover: scanned.cover };
}

/**
 * A folder becomes a series only once it holds a second project. A short story
 * has no chapter folder to be filed under, and inventing a series of one would
 * put a disclosure triangle in front of every one of them.
 *
 * A project reachable from more than one scan point is listed once, and where
 * it is listed as part of a series that placement wins: the series is the more
 * specific answer to where the project belongs.
 */
export function buildLibrary(scanPoints: readonly ScannedScanPoint[]): LibraryEntry[] {
  const byScanPoint = new Map<string, Map<string, ScannedProject>>();
  for (const point of scanPoints) {
    let projects = byScanPoint.get(point.path);
    if (!projects) {
      projects = new Map();
      byScanPoint.set(point.path, projects);
    }
    for (const project of point.projects) projects.set(project.path, project);
  }

  const series: LibraryEntry[] = [];
  const claimed = new Set<string>();
  const loose = new Map<string, ScannedProject>();

  for (const [path, projects] of byScanPoint) {
    if (projects.size < 2) continue;
    const members = [...projects.values()].map(toProject).sort((a, b) => collator.compare(a.name, b.name));
    for (const member of members) claimed.add(member.path);
    series.push({ kind: "series", path, name: folderName(path), projects: members });
  }

  for (const projects of byScanPoint.values()) {
    if (projects.size >= 2) continue;
    for (const project of projects.values()) loose.set(project.path, project);
  }

  const entries: LibraryEntry[] = [...series];
  for (const project of loose.values()) {
    if (claimed.has(project.path)) continue;
    entries.push({ kind: "project", ...toProject(project) });
  }

  return entries.sort((a, b) => collator.compare(a.name, b.name));
}
