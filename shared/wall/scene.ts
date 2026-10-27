import type { LayerEffect } from "../effects/types";
import type { TagRegistry } from "../tags/types";
import type { TextStyle } from "../text-style/types";

/**
 * One translation as the wall draws it: its words, its look, and where to send
 * the editor when it is pointed at. The wall window holds no project of its
 * own, so this is everything it knows.
 */
export interface WallEntry {
  id: string;
  pageId: string;
  /** Counting from one, as the page bar does. */
  pageNumber: number;
  code: string;
  style: TextStyle;
  effects: LayerEffect[];
  /** What its translation means, which the wall groups by before it looks at style. */
  tags: string[];
}

/** The open chapter's translations, or nothing when no project is open. */
export interface WallScene {
  entries: WallEntry[];
  /** The project's tags, for their order and colours. */
  registry: TagRegistry;
  /** The page the editor is on, for a wall narrowed to one page. */
  currentPageId: string | null;
}
