import type {
  ChooseOutcome,
  FaceTexts,
  PageTexts,
  ProposeOutcome,
  SentenceTexts,
  TranslationCandidateView,
  WithdrawOutcome,
  WriteResult,
} from "./types";

/**
 * The wire answer is a script for a model to read, not JSON: ids stay next to
 * the text they name, and an empty answer is said out loud — a blank line
 * would read as "nothing here" when it means "not translated yet".
 */
/** Line breaks inside a text become ／ so one script row stays one fact. */
function flat(text: string): string {
  return text.replaceAll("\n", "／");
}

/**
 * Who wrote a candidate, told only as far as the reader acts on it: a
 * person's is never withdrawn, the caller's own may be, and every other
 * client's is somebody else's.
 */
function authorOf(candidate: TranslationCandidateView, caller: string | undefined): string {
  if (candidate.human) return "（human）";
  if (caller !== undefined && candidate.source === caller) return "（你）";
  return "（AI）";
}

function drawerOf(candidates: readonly TranslationCandidateView[], caller: string | undefined): string {
  return candidates
    .map((c) => `${c.chosen ? "✓" : ""}${c.id}「${flat(c.text)}」${authorOf(c, caller)}`)
    .join(" ／ ");
}

export function renderSentence(sentence: SentenceTexts, caller?: string): string {
  const out: string[] = [sentence.id];
  out.push(`  原文: ${sentence.source === null ? "（無）" : flat(sentence.source)}`);
  out.push(`  譯文: ${sentence.translation === "" ? "（未翻）" : flat(sentence.translation)}`);
  // Said only where there are several, so an ordinary balloon's lines stay
  // about the words rather than about how they were set.
  if (sentence.blocks) {
    out.push(`  這一句的譯文分成 ${sentence.blocks.length} 塊，讀起來中間是「/」——提案請指定塊 id`);
    for (const block of sentence.blocks) {
      out.push(`  塊 ${block.id}: ${block.text === "" ? "（未翻）" : flat(block.text)}`);
      if (block.candidates.length > 0) out.push(`    候選: ${drawerOf(block.candidates, caller)}`);
    }
  } else if (sentence.candidates.length > 0) {
    out.push(`  候選: ${drawerOf(sentence.candidates, caller)}`);
  }
  return out.join("\n");
}

function renderFace(
  pageId: string,
  face: FaceTexts,
  caller: string | undefined,
  gone: readonly string[] | undefined,
  out: string[],
): void {
  out.push(`頁 ${pageId} · ${face.name} · ${face.sentences.length} 句`);
  for (const sentence of face.sentences) out.push(renderSentence(sentence, caller));
  if (gone && gone.length > 0) out.push(`  已不存在：${gone.join("、")}`);
}

function renderPage(
  page: PageTexts,
  caller: string | undefined,
  gone: ReadonlyMap<string, readonly string[]> | undefined,
  out: string[],
): void {
  if (page.badge !== "ok") {
    out.push(`頁 ${page.pageId} ·（${page.badge}，內容不可讀）`);
    return;
  }
  if (page.faces.length === 0) {
    out.push(`頁 ${page.pageId} ·（沒有翻譯面）`);
    return;
  }
  for (const face of page.faces) renderFace(page.pageId, face, caller, gone?.get(face.faceId), out);
}

export interface TextsView {
  caller?: string;
  /** Pages asked for by id that the project does not have. */
  missing?: readonly string[];
  /**
   * Set when only what changed since the last read is shown: the sentence ids
   * that are gone since, per page and then per face.
   */
  changedOnly?: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}

export function renderTexts(pages: PageTexts[], view: TextsView = {}): string {
  const total = pages.reduce((n, p) => n + p.faces.reduce((m, f) => m + f.sentences.length, 0), 0);
  const out: string[] = [
    view.changedOnly
      ? `自上次讀取後 · ${pages.length} 頁有變動 · ${total} 句`
      : `專案 · ${pages.length} 頁 · ${total} 句`,
  ];
  if (view.missing && view.missing.length > 0) out.push(`沒有這些頁：${view.missing.join("、")}`);
  for (const page of pages) {
    out.push("");
    renderPage(page, view.caller, view.changedOnly?.get(page.pageId), out);
  }
  return out.join("\n");
}

/** What one session last read of each sentence, rendered, per page and then per face. */
export type SeenTexts = Map<string, Map<string, Map<string, string>>>;

/**
 * Records what these pages read as now, so the next `sinceSeen` compares
 * against it. `whole` for a read of entire pages, which also forgets what is
 * gone; a write's reply carries only the sentences it touched.
 */
export function noteSeen(
  seen: SeenTexts,
  pages: readonly PageTexts[],
  caller: string | undefined,
  whole: boolean,
): void {
  for (const page of pages) {
    let faces = whole ? undefined : seen.get(page.pageId);
    if (!faces) {
      faces = new Map();
      seen.set(page.pageId, faces);
    }
    for (const face of page.faces) {
      let held = whole ? undefined : faces.get(face.faceId);
      if (!held) {
        held = new Map();
        faces.set(face.faceId, held);
      }
      for (const sentence of face.sentences) held.set(sentence.id, renderSentence(sentence, caller));
    }
  }
}

/**
 * These pages cut down to the sentences that read differently from the last
 * time this session saw them, one never seen counting as changed, plus the ids
 * seen before that are no longer there. A page with neither is left out; a
 * damaged page is kept, since its badge is the change worth saying.
 *
 * ⚠️ A write's reply is a read too, so the caller's own writes do not come
 * back as changes — only what somebody else did since.
 */
export function sinceSeen(
  seen: SeenTexts,
  pages: readonly PageTexts[],
  caller: string | undefined,
): { pages: PageTexts[]; gone: Map<string, Map<string, string[]>> } {
  const changed: PageTexts[] = [];
  const gone = new Map<string, Map<string, string[]>>();
  for (const page of pages) {
    const heldFaces = seen.get(page.pageId);
    const faces: FaceTexts[] = [];
    const lostHere = new Map<string, string[]>();
    for (const face of page.faces) {
      const held = heldFaces?.get(face.faceId);
      const sentences = face.sentences.filter((s) => held?.get(s.id) !== renderSentence(s, caller));
      const here = new Set(face.sentences.map((s) => s.id));
      const lost = page.badge === "ok" && held ? [...held.keys()].filter((id) => !here.has(id)) : [];
      if (lost.length > 0) lostHere.set(face.faceId, lost);
      if (sentences.length > 0 || lost.length > 0) faces.push({ ...face, sentences });
    }
    if (lostHere.size > 0) gone.set(page.pageId, lostHere);
    if (faces.length > 0 || page.badge !== "ok") changed.push({ ...page, faces });
  }
  return { pages: changed, gone };
}

function withStates(head: string[], pages: PageTexts[], caller: string | undefined): string {
  if (pages.length > 0) {
    head.push("", "操作後的狀態：");
    for (const page of pages) renderPage(page, caller, undefined, head);
  }
  return head.join("\n");
}

export function renderProposeResult(result: WriteResult<ProposeOutcome>, caller?: string): string {
  const taken = result.outcomes.filter((o) => o.ok);
  const refused = result.outcomes.filter((o) => !o.ok);
  const out: string[] = [`收下 ${taken.length} 則，拒絕 ${refused.length} 則`];
  for (const o of result.outcomes) {
    if (o.ok) {
      out.push(
        `${o.pageId} · ${o.objectId} → 候選 ${o.translationId}` +
          (o.filledSlot ? "（已生效）" : "（進入抽屜，現值未動）"),
      );
    } else {
      out.push(`${o.pageId} · ${o.objectId} ✗ ${o.reason}`);
    }
  }
  return withStates(out, result.pages, caller);
}

export function renderChooseResult(result: WriteResult<ChooseOutcome>, caller?: string): string {
  const out = result.outcomes.map((o) =>
    o.ok
      ? `${o.pageId} · ${o.objectId} 現在讀作候選 ${o.translationId}`
      : `${o.pageId} · ${o.objectId} ✗ ${o.reason}（${o.translationId}）`,
  );
  return withStates(out, result.pages, caller);
}

export function renderWithdrawResult(result: WriteResult<WithdrawOutcome>, caller?: string): string {
  const out = result.outcomes.map((o) =>
    o.ok
      ? `${o.pageId} · 候選 ${o.translationId} 已撤回` +
        (o.clearedSlot ? "（原為現值，物件已回退為自己的字）" : "（現值未動）")
      : `${o.pageId} · 候選 ${o.translationId} ✗ ${o.reason}`,
  );
  return withStates(out, result.pages, caller);
}
