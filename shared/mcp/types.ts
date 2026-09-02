import type { PageBadge } from "../ipc/channels";

/**
 * The main process hosts the MCP endpoint but the data model lives in the
 * renderer, so every call is a question sent across and answered back. These
 * envelopes are that correlation: the id is minted by the asker and echoed by
 * the answer, nothing else ties a reply to its question.
 */
export type McpQueryMethod =
  | "get_texts"
  | "propose_translations"
  | "choose_translation"
  | "withdraw_translation";

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

export interface TranslationTexts {
  id: string;
  /** Resolved source text, or null where no reading names what the artwork says. */
  source: string | null;
  /** What this reads as today — the slot resolved, the blocks' own words otherwise. */
  translation: string;
  /**
   * How many blocks of lettering the translation is set in. One is the ordinary
   * case; more means a sound was split across the artwork, and a proposal has to
   * carry that many pieces to be choosable.
   */
  blocks: number;
  candidates: TranslationCandidateView[];
}

export interface PageTexts {
  pageId: string;
  badge: PageBadge;
  objects: TranslationTexts[];
}

export interface ProposeItem {
  unitId: string;
  /** The whole translation, one line per array entry. */
  lines?: string[];
  /**
   * The translation already cut into blocks, one array of lines each.
   *
   * ⚠️ Where lettering goes on the artwork is a decision about the drawing, not
   * about the language, so this is here to keep the surface from being unable to
   * say it rather than because anything should reach for it. `lines` is the
   * ordinary way in and means one block.
   */
  pieces?: string[][];
}

export interface ProposeParams {
  pageId: string;
  items: ProposeItem[];
  /** The proposing client, from the session's clientInfo — not model-supplied. */
  source?: string;
}

export type ProposeOutcome =
  | { unitId: string; ok: true; translationId: string; filledSlot: boolean }
  | { unitId: string; ok: false; reason: string };

export interface ChooseItem {
  unitId: string;
  translationId: string;
}

export interface ChooseParams {
  pageId: string;
  items: ChooseItem[];
}

export type ChooseOutcome =
  | { unitId: string; translationId: string; ok: true }
  | { unitId: string; translationId: string; ok: false; reason: string };

export interface WithdrawParams {
  pageId: string;
  items: ChooseItem[];
  /** The withdrawing client's clientInfo — must match each candidate's stamp. */
  source?: string;
}

export type WithdrawOutcome =
  | { unitId: string; translationId: string; ok: true; clearedSlot: boolean }
  | { unitId: string; translationId: string; ok: false; reason: string };

/**
 * Every write answers with the touched objects' full current state, so a
 * caller audits what actually happened in the same breath rather than by a
 * second read.
 */
export interface WriteResult<Outcome> {
  outcomes: Outcome[];
  objects: TranslationTexts[];
}
