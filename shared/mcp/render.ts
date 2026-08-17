import type {
  ChooseOutcome,
  PageTexts,
  ProposeOutcome,
  TextObjectTexts,
  WithdrawOutcome,
  WriteResult,
} from "./types";

/**
 * The wire answer is a script for a model to read, not JSON: ids stay next to
 * the text they name, and an empty answer is said out loud — a blank line
 * would read as "nothing here" when it means "not translated yet".
 */
export function renderObject(obj: TextObjectTexts): string {
  const out: string[] = [obj.id];
  out.push(`  原文: ${obj.source ?? "（無）"}`);
  out.push(`  譯文: ${obj.translation === "" ? "（未翻）" : obj.translation}`);
  if (obj.candidates.length > 0) {
    const drawer = obj.candidates
      .map((c) => {
        const who = c.human ? "（human）" : c.source ? `（${c.source}）` : "";
        return `${c.chosen ? "✓" : ""}${c.id}「${c.text}」${who}`;
      })
      .join(" ／ ");
    out.push(`  候選: ${drawer}`);
  }
  return out.join("\n");
}

export function renderTexts(pages: PageTexts[]): string {
  const total = pages.reduce((n, p) => n + p.objects.length, 0);
  const out: string[] = [`專案 · ${pages.length} 頁 · ${total} 個文字物件`];
  for (const page of pages) {
    out.push("");
    if (page.badge !== "ok") {
      out.push(`頁 ${page.pageId} ·（${page.badge}，內容不可讀）`);
      continue;
    }
    out.push(`頁 ${page.pageId} · ${page.objects.length} 個文字物件`);
    for (const obj of page.objects) out.push(renderObject(obj));
  }
  return out.join("\n");
}

function withStates(head: string[], objects: TextObjectTexts[]): string {
  if (objects.length > 0) {
    head.push("", "操作後的物件狀態：");
    for (const obj of objects) head.push(renderObject(obj));
  }
  return head.join("\n");
}

export function renderProposeResult(result: WriteResult<ProposeOutcome>): string {
  const taken = result.outcomes.filter((o) => o.ok);
  const refused = result.outcomes.filter((o) => !o.ok);
  const out: string[] = [`收下 ${taken.length} 則，拒絕 ${refused.length} 則`];
  for (const o of result.outcomes) {
    if (o.ok) {
      out.push(
        `${o.objectId} → 候選 ${o.translationId}` +
          (o.filledSlot ? "（物件原本空白，已直接生效）" : "（進入抽屜，現值未動）"),
      );
    } else {
      out.push(`${o.objectId} ✗ ${o.reason}`);
    }
  }
  return withStates(out, result.objects);
}

export function renderChooseResult(result: WriteResult<ChooseOutcome>): string {
  const out = result.outcomes.map((o) =>
    o.ok
      ? `${o.objectId} 現在讀作候選 ${o.translationId}`
      : `${o.objectId} ✗ ${o.reason}（${o.translationId}）`,
  );
  return withStates(out, result.objects);
}

export function renderWithdrawResult(result: WriteResult<WithdrawOutcome>): string {
  const out = result.outcomes.map((o) =>
    o.ok
      ? `候選 ${o.translationId} 已撤回` +
        (o.clearedSlot ? "（原為現值，物件已回退為自己的字）" : "（現值未動）")
      : `候選 ${o.translationId} ✗ ${o.reason}`,
  );
  return withStates(out, result.objects);
}
