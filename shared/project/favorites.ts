import { folderName } from "./library";
import type { ProjectCard } from "./workspace";

export interface FavoriteMember {
  path: string;
  /** The project's id when it was added, so a move can be recognised; null for one without an id. */
  projectId: string | null;
}

export interface Favorite {
  id: string;
  name: string;
  members: FavoriteMember[];
}

export function missingCard(path: string, projectId: string | null): ProjectCard {
  return { path, name: folderName(path), found: false, id: projectId, cover: null, pageCount: 0 };
}

/**
 * The projects a favorite shows: each member where it was put, and every folder
 * seen anywhere carrying a member's id — a copy or a move shows up beside the
 * original rather than being told apart from it. A member whose path holds
 * nothing is shown missing only when its id turned up nowhere else.
 */
export function favoriteCards(
  favorite: Favorite,
  byPath: ReadonlyMap<string, ProjectCard>,
  seen: readonly ProjectCard[],
): ProjectCard[] {
  const out: ProjectCard[] = [];
  const taken = new Set<string>();
  const add = (card: ProjectCard) => {
    if (taken.has(card.path)) return;
    taken.add(card.path);
    out.push(card);
  };

  for (const member of favorite.members) {
    const atPath = byPath.get(member.path);
    if (atPath?.found) add(atPath);
    const elsewhere =
      member.projectId === null ? [] : seen.filter((card) => card.found && card.id === member.projectId);
    for (const card of elsewhere) add(card);
    if (!atPath?.found && elsewhere.length === 0) add(missingCard(member.path, member.projectId));
  }
  return out;
}

/**
 * Members whose path no longer holds the project, pointed at the first place its
 * id was seen. Null when nothing moved, so a caller can skip the write.
 */
export function healedMembers(
  favorite: Favorite,
  byPath: ReadonlyMap<string, ProjectCard>,
  seen: readonly ProjectCard[],
): FavoriteMember[] | null {
  let moved = false;
  const members = favorite.members.map((member) => {
    if (byPath.get(member.path)?.found || member.projectId === null) return member;
    const found = seen.find((card) => card.found && card.id === member.projectId);
    if (!found) return member;
    moved = true;
    return { path: found.path, projectId: member.projectId };
  });
  return moved ? members : null;
}
