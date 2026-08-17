import type { PageBadge } from "../ipc/channels";

/**
 * The main process hosts the MCP endpoint but the data model lives in the
 * renderer, so every read is a question sent across and answered back. These
 * envelopes are that correlation: the id is minted by the asker and echoed by
 * the answer, nothing else ties a reply to its question.
 */
export type McpQueryMethod = "get_texts";

export interface McpQuery {
  id: string;
  method: McpQueryMethod;
}

export interface McpReply {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface TextObjectTexts {
  id: string;
  /** Resolved source text, or null where no reading names what the artwork says. */
  source: string | null;
  /** What the object reads as today — the translation slot resolved, own lines otherwise. */
  translation: string;
}

export interface PageTexts {
  pageId: string;
  badge: PageBadge;
  objects: TextObjectTexts[];
}
