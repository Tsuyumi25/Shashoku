import type {
  ChooseOutcome,
  PageTexts,
  ProposeOutcome,
  TranslationTexts,
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
function authorOf(candidate: TranslationTexts["candidates"][number], caller: string | undefined): string {
  if (candidate.human) return "（human）";
  if (caller !== undefined && candidate.source === caller) return "（你）";
  return "（AI）";
}

export function renderObject(obj: TranslationTexts, caller?: string): string {
  const out: string[] = [obj.id];
  out.push(`  原文: ${obj.source === null ? "（無）" : flat(obj.source)}`);
  out.push(`  譯文: ${obj.translation === "" ? "（未翻）" : flat(obj.translation)}`);
  // Said only where it is not one, so an ordinary balloon's line stays a line
  // about the words rather than about how they were set.
  if (obj.blocks > 1) out.push(`  譯文分成 ${obj.blocks} 塊——候選要用 pieces 送同樣多塊才選得起來`);
  if (obj.candidates.length > 0) {
    const drawer = obj.candidates
      .map((c) => `${c.chosen ? "✓" : ""}${c.id}「${flat(c.text)}」${authorOf(c, caller)}`)
      .join(" ／ ");
    out.push(`  候選: ${drawer}`);
  }
  return out.join("\n");
}

function renderPage(page: PageTexts, caller: string | undefined, out: string[]): void {
  if (page.badge !== "ok") {
    out.push(`頁 ${page.pageId} ·（${page.badge}，內容不可讀）`);
    return;
  }
  out.push(`頁 ${page.pageId} · ${page.objects.length} 個文字物件`);
  for (const obj of page.objects) out.push(renderObject(obj, caller));
}

export interface TextsView {
  caller?: string;
  /** Pages asked for by id that the project does not have. */
  missing?: readonly string[];
  /** Set when only what changed since the last read is shown: the ids that are gone since, per page. */
  changedOnly?: ReadonlyMap<string, readonly string[]>;
}

export function renderTexts(pages: PageTexts[], view: TextsView = {}): string {
  const total = pages.reduce((n, p) => n + p.objects.length, 0);
  const out: string[] = [
    view.changedOnly
      ? `自上次讀取後 · ${pages.length} 頁有變動 · ${total} 筆翻譯`
      : `專案 · ${pages.length} 頁 · ${total} 筆翻譯`,
  ];
  if (view.missing && view.missing.length > 0) out.push(`沒有這些頁：${view.missing.join("、")}`);
  for (const page of pages) {
    out.push("");
    renderPage(page, view.caller, out);
    const gone = view.changedOnly?.get(page.pageId);
    if (gone && gone.length > 0) out.push(`  已不存在：${gone.join("、")}`);
  }
  return out.join("\n");
}

/** What one session last read of each object, rendered, per page. */
export type SeenTexts = Map<string, Map<string, string>>;

/**
 * Records what these pages read as now, so the next `sinceSeen` compares
 * against it. `whole` for a read of entire pages, which also forgets what is
 * gone; a write's reply carries only the objects it touched.
 */
export function noteSeen(
  seen: SeenTexts,
  pages: readonly PageTexts[],
  caller: string | undefined,
  whole: boolean,
): void {
  for (const page of pages) {
    let held = whole ? undefined : seen.get(page.pageId);
    if (!held) {
      held = new Map();
      seen.set(page.pageId, held);
    }
    for (const obj of page.objects) held.set(obj.id, renderObject(obj, caller));
  }
}

/**
 * These pages cut down to the objects that read differently from the last
 * time this session saw them, an object never seen counting as changed, plus
 * the ids seen before that are no longer there. A page with neither is left
 * out; a damaged page is kept, since its badge is the change worth saying.
 *
 * ⚠️ A write's reply is a read too, so the caller's own writes do not come
 * back as changes — only what somebody else did since.
 */
export function sinceSeen(
  seen: SeenTexts,
  pages: readonly PageTexts[],
  caller: string | undefined,
): { pages: PageTexts[]; gone: Map<string, string[]> } {
  const changed: PageTexts[] = [];
  const gone = new Map<string, string[]>();
  for (const page of pages) {
    const held = seen.get(page.pageId);
    const objects = page.objects.filter((obj) => held?.get(obj.id) !== renderObject(obj, caller));
    const here = new Set(page.objects.map((obj) => obj.id));
    const lost = page.badge === "ok" && held ? [...held.keys()].filter((id) => !here.has(id)) : [];
    if (lost.length > 0) gone.set(page.pageId, lost);
    if (objects.length > 0 || lost.length > 0 || page.badge !== "ok") changed.push({ ...page, objects });
  }
  return { pages: changed, gone };
}

function withStates(head: string[], pages: PageTexts[], caller: string | undefined): string {
  if (pages.length > 0) {
    head.push("", "操作後的物件狀態：");
    for (const page of pages) {
      head.push(`頁 ${page.pageId}`);
      for (const obj of page.objects) head.push(renderObject(obj, caller));
    }
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
        `${o.pageId} · ${o.unitId} → 候選 ${o.translationId}` +
          (o.filledSlot ? "（已生效）" : "（進入抽屜，現值未動）"),
      );
    } else {
      out.push(`${o.pageId} · ${o.unitId} ✗ ${o.reason}`);
    }
  }
  return withStates(out, result.pages, caller);
}

export function renderChooseResult(result: WriteResult<ChooseOutcome>, caller?: string): string {
  const out = result.outcomes.map((o) =>
    o.ok
      ? `${o.pageId} · ${o.unitId} 現在讀作候選 ${o.translationId}`
      : `${o.pageId} · ${o.unitId} ✗ ${o.reason}（${o.translationId}）`,
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
