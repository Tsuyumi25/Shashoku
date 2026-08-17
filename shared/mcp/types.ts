import type { PageBadge } from "../ipc/channels";

/**
 * The main process hosts the MCP endpoint but the data model lives in the
 * renderer, so every call is a question sent across and answered back. These
 * envelopes are that correlation: the id is minted by the asker and echoed by
 * the answer, nothing else ties a reply to its question.
 */
export type McpQueryMethod = "get_texts" | "propose_translations" | "choose_translation";

export interface McpQuery {
  id: string;
  method: McpQueryMethod;
  params?: unknown;
}

export interface McpReply {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface TranslationCandidateView {
  id: string;
  text: string;
  /** A person wrote or corrected this one; it may never be edited, only appended after. */
  human: boolean;
  /** Where the slot points today. */
  chosen: boolean;
  /** Which client proposed it — clientInfo stamped by the server, display only. */
  source?: string;
}

export interface TextObjectTexts {
  id: string;
  /** Resolved source text, or null where no reading names what the artwork says. */
  source: string | null;
  /** What the object reads as today — the translation slot resolved, own lines otherwise. */
  translation: string;
  candidates: TranslationCandidateView[];
}

export interface PageTexts {
  pageId: string;
  badge: PageBadge;
  objects: TextObjectTexts[];
}

export interface ProposeItem {
  objectId: string;
  lines: string[];
}

export interface ProposeParams {
  pageId: string;
  items: ProposeItem[];
  /** The proposing client, from the session's clientInfo — not model-supplied. */
  source?: string;
}

export type ProposeOutcome =
  | { objectId: string; ok: true; translationId: string; filledSlot: boolean }
  | { objectId: string; ok: false; reason: string };

export interface ChooseParams {
  pageId: string;
  objectId: string;
  translationId: string;
}
