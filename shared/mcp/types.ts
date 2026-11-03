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
  /** Its name in the drawer — 1 is `a`, which is what an address spells. */
  letter: string;
  text: string;
  /** A person wrote or corrected this one; it may never be edited, only appended after. */
  human: boolean;
  /** Where this block's slot points today. */
  chosen: boolean;
  /** Which client proposed it — clientInfo stamped by the server, display only. */
  source?: string;
}

/** One block of lettering a sentence is set in. */
export interface BlockTexts {
  id: string;
  no: number;
  /**
   * Every address that reaches this block, the first being the one to show.
   * A sentence set in one block has two: `p7/14` and `p7/14.1`.
   */
  refs: string[];
  /** What this block reads as today — its slot resolved, its own words otherwise. */
  text: string;
  candidates: TranslationCandidateView[];
}

export interface SourceBlockTexts {
  no: number;
  text: string;
}

export interface SentenceTexts {
  id: string;
  no: number;
  /** The artwork's words, block by block, each under the number it wears. */
  sources: SourceBlockTexts[];
  /** What the whole sentence reads as today, its blocks joined as they are read. */
  translation: string;
  blocks: BlockTexts[];
  /** What the sentence means, as the artwork's blocks are tagged. */
  tags: string[];
}

/** One face's reading of a page: its number, its name as the person set it, its sentences. */
export interface FaceTexts {
  faceId: string;
  faceNo: number;
  name: string;
  /** In the order the reading lines lay them out, then those no line touches. */
  sentences: SentenceTexts[];
  /** The reading lines between sentences, by number: `from` is read before `to`. */
  edges: { from: number; to: number }[];
}

export interface PageTexts {
  pageId: string;
  /** Where the page reads among the chapter's pages, 1-based. */
  no: number;
  /** The page's name as the manifest holds it. */
  name: string;
  badge: PageBadge;
  faces: FaceTexts[];
}

export interface GetTextsParams {
  /** Only these pages, in the project's order. Every page when absent. */
  pageIds?: string[];
  /** `f2`. Every face when absent. */
  face?: string;
}

/**
 * What a write names, and what that name stood for the last time this session
 * was shown it. The session's memory is the only thing that catches a page
 * regrouped since: nothing in the project records that a number changed hands.
 */
export interface WriteRef {
  ref: string;
  /** The object id the ref stood for when the session saw it, by face id. */
  seen?: Record<string, string>;
}

export interface ProposeItem extends WriteRef {
  /** The translation of that one block, one line per array entry. */
  lines: string[];
  /** Point the block at the new candidate whatever it reads as now. */
  choose?: boolean;
}

export interface ProposeParams {
  /** `f2`. The active face when absent; every ref in the call resolves in it. */
  face?: string;
  items: ProposeItem[];
  /** The proposing client, from the session's clientInfo — not model-supplied. */
  source?: string;
}

export type ProposeOutcome =
  | { ref: string; ok: true; candidateRef: string; filledSlot: boolean }
  | { ref: string; ok: false; reason: string };

export interface ChooseParams {
  face?: string;
  items: WriteRef[];
}

export type ChooseOutcome =
  | { ref: string; ok: true }
  | { ref: string; ok: false; reason: string };

export interface WithdrawParams {
  face?: string;
  items: WriteRef[];
  /** The withdrawing client's clientInfo — must match each candidate's stamp. */
  source?: string;
}

export type WithdrawOutcome =
  | { ref: string; ok: true; clearedSlot: boolean }
  | { ref: string; ok: false; reason: string };

/**
 * Every write answers with the touched sentences' full current state, page by
 * page, so a caller audits what actually happened in the same breath rather
 * than by a second read.
 */
export interface WriteResult<Outcome> {
  outcomes: Outcome[];
  pages: PageTexts[];
}
