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
  /** Where this block's slot points today. */
  chosen: boolean;
  /** Which client proposed it — clientInfo stamped by the server, display only. */
  source?: string;
}

/**
 * One block of lettering a sentence is set in, named only where there are
 * several: a sentence set in one block is addressed by the sentence's own id,
 * and listing its single block again would be two names for one thing.
 */
export interface BlockTexts {
  id: string;
  /** What this block reads as today — its slot resolved, its own words otherwise. */
  text: string;
  candidates: TranslationCandidateView[];
}

export interface SentenceTexts {
  id: string;
  /** Resolved source text, or null where no reading names what the artwork says. */
  source: string | null;
  /** What the whole sentence reads as today, its blocks joined as they are read. */
  translation: string;
  /**
   * The blocks of lettering, only where the sentence is set in more than one.
   * Writes then address a block rather than the sentence, since no candidate
   * can speak for a stretch of lettering no block shows.
   */
  blocks?: BlockTexts[];
  /** The one block's drawer, where the sentence is set in one block. */
  candidates: TranslationCandidateView[];
}

/** One face's reading of a page: its name as the person set it, and its sentences. */
export interface FaceTexts {
  faceId: string;
  name: string;
  sentences: SentenceTexts[];
}

export interface PageTexts {
  pageId: string;
  badge: PageBadge;
  faces: FaceTexts[];
}

export interface GetTextsParams {
  /** Only these pages, in the project's order. Every page when absent. */
  pageIds?: string[];
}

/**
 * What a write names: a block of lettering, or a sentence standing for its one
 * block. A sentence set in several is refused rather than resolved, since
 * nothing says which of its blocks the words were meant for.
 */
export interface ProposeItem {
  pageId: string;
  objectId: string;
  /** The translation of that one block, one line per array entry. */
  lines: string[];
  /** Point the block at the new candidate whatever it reads as now. */
  choose?: boolean;
}

export interface ProposeParams {
  items: ProposeItem[];
  /** The proposing client, from the session's clientInfo — not model-supplied. */
  source?: string;
}

export type ProposeOutcome =
  | { pageId: string; objectId: string; ok: true; translationId: string; filledSlot: boolean }
  | { pageId: string; objectId: string; ok: false; reason: string };

export interface ChooseItem {
  pageId: string;
  objectId: string;
  translationId: string;
}

export interface ChooseParams {
  items: ChooseItem[];
}

export type ChooseOutcome = (ChooseItem & { ok: true }) | (ChooseItem & { ok: false; reason: string });

export interface WithdrawParams {
  items: ChooseItem[];
  /** The withdrawing client's clientInfo — must match each candidate's stamp. */
  source?: string;
}

export type WithdrawOutcome =
  | (ChooseItem & { ok: true; clearedSlot: boolean })
  | (ChooseItem & { ok: false; reason: string });

/**
 * Every write answers with the touched objects' full current state, page by
 * page, so a caller audits what actually happened in the same breath rather
 * than by a second read.
 */
export interface WriteResult<Outcome> {
  outcomes: Outcome[];
  pages: PageTexts[];
}
