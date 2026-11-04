import type {
  BlockTexts,
  ChooseOutcome,
  FaceTexts,
  PageTexts,
  ProposeOutcome,
  SentenceTexts,
  TranslationCandidateView,
  WithdrawOutcome,
  WriteResult,
} from "./types";
import { withoutFace } from "./refs";
import { plainOf } from "../page/markup";

/**
 * The wire answer is a script for a model to read, not JSON: every address
 * stays next to the text it names, and an empty answer is said out loud — a
 * blank line would read as "nothing here" when it means "not translated yet".
 */
/** Line breaks inside one block become ⏎, so one script row stays one fact. */
function flat(text: string): string {
  return text.replaceAll("\n", "⏎");
}

const INDENT = "    ";

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
    .map((c) => `${c.letter}${c.chosen ? "✓" : " "}「${flat(c.text)}」${authorOf(c, caller)}`)
    .join(" ／ ");
}

function sourcesOf(sentence: SentenceTexts): string {
  const said = sentence.sources.filter((b) => b.text !== "");
  if (said.length === 0) return "（無）";
  return said.map((b) => `s${b.no} ${flat(b.text)}`).join(" / ");
}

function blockLine(sentence: SentenceTexts, block: BlockTexts, caller: string | undefined): string {
  const drawer = block.candidates.length === 0 ? "（抽屜空）" : `候選 ${drawerOf(block.candidates, caller)}`;
  const text = block.text === "" ? "（未翻）" : flat(block.text);
  return `${INDENT}${sentence.no}.${block.no} ${text}  ${drawer}`;
}

export function renderSentence(sentence: SentenceTexts, caller?: string): string {
  const out = [`${sentence.no}  原文 ${sourcesOf(sentence)}`];
  out.push(`${INDENT}譯文 ${sentence.translation === "" ? "（未翻）" : flat(sentence.translation)}`);
  if (sentence.blocks.length === 0) {
    out.push(`${INDENT}（這一面還沒有譯文方塊）`);
  } else if (sentence.blocks.length === 1) {
    const drawer = sentence.blocks[0].candidates;
    if (drawer.length > 0) out.push(`${INDENT}候選 ${drawerOf(drawer, caller)}`);
  } else {
    for (const block of sentence.blocks) out.push(blockLine(sentence, block, caller));
  }
  return out.join("\n");
}

function headOf(page: PageTexts): string {
  return `第 ${page.no} 頁 · ${page.pageId} · ${page.name}`;
}

/**
 * Mermaid takes `#name;` for what its label syntax would otherwise read; the
 * markup is dropped first, since a label is for reading the story by and the
 * list above it keeps the tags.
 */
function labelText(code: string): string {
  return plainOf(code)
    .replaceAll("\n", " ")
    .replaceAll("&", "#amp;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;");
}

/** What a node says besides its number. An agent is given all three. */
export interface MermaidParts {
  translation: boolean;
  source: boolean;
  tags: boolean;
}

const EVERY_PART: MermaidParts = { translation: true, source: true, tags: true };

function nodeOf(sentence: SentenceTexts, parts: MermaidParts): string {
  const said: string[] = [];
  if (parts.translation) {
    said.push(`譯：${sentence.translation === "" ? "（未翻）" : labelText(sentence.translation)}`);
  }
  if (parts.source) {
    const source = sentence.sources.filter((b) => b.text !== "").map((b) => labelText(b.text));
    said.push(`原：${source.length === 0 ? "（無）" : source.join(" / ")}`);
  }
  if (parts.tags && sentence.tags.length > 0) said.push(`標記：${sentence.tags.map(labelText).join("、")}`);
  const label = said.length === 0 ? `${sentence.no}` : `${sentence.no} ${said.join("<br/>")}`;
  return `n${sentence.no}["${label}"]`;
}

/** Lines drawn as the graph; what no line touches stays apart, in list order, and is not read into it. */
export function mermaidOf(face: FaceTexts, parts: MermaidParts = EVERY_PART): string {
  const touched = new Set(face.edges.flatMap((e) => [e.from, e.to]));
  const out = ["flowchart TD"];
  for (const s of face.sentences) if (touched.has(s.no)) out.push(`  ${nodeOf(s, parts)}`);
  for (const e of face.edges) out.push(`  n${e.from} --> n${e.to}`);
  const loose = face.sentences.filter((s) => !touched.has(s.no));
  if (loose.length > 0) {
    out.push('  subgraph unlinked["未維護"]');
    for (const s of loose) out.push(`    ${nodeOf(s, parts)}`);
    out.push("  end");
  }
  return out.join("\n");
}

/**
 * Flowcharts as a document a person can paste: a heading and one fenced chart
 * for every page and face that has sentences, headed the way get_texts heads
 * its sections.
 */
export function mermaidDocument(pages: readonly PageTexts[], parts: MermaidParts = EVERY_PART): string {
  const out: string[] = [];
  for (const page of pages) {
    for (const face of page.faces) {
      if (face.sentences.length === 0) continue;
      out.push(`## ${headOf(page)} · f${face.faceNo} ${face.name}`, "", "```mermaid", mermaidOf(face, parts), "```", "");
    }
  }
  return out.join("\n");
}

function renderMermaid(face: FaceTexts): string {
  return ["```mermaid", mermaidOf(face), "```"].join("\n");
}

function renderFace(
  page: PageTexts,
  face: FaceTexts,
  caller: string | undefined,
  gone: readonly string[] | undefined,
  graph: string | undefined,
  out: string[],
): void {
  out.push(`${headOf(page)} · f${face.faceNo} ${face.name} · ${face.sentences.length} 句`);
  for (const sentence of face.sentences) out.push(renderSentence(sentence, caller));
  if (gone && gone.length > 0) out.push(`${INDENT}已不存在：${gone.join("、")}`);
  if (graph !== undefined) out.push(graph);
}

function renderPage(
  page: PageTexts,
  caller: string | undefined,
  gone: ReadonlyMap<string, readonly string[]> | undefined,
  graphs: ReadonlyMap<string, string> | undefined,
  out: string[],
): void {
  if (page.badge !== "ok") {
    out.push(`${headOf(page)} ·（${page.badge}，內容不可讀）`);
    return;
  }
  if (page.faces.length === 0) {
    out.push(`${headOf(page)} ·（沒有翻譯面）`);
    return;
  }
  for (const face of page.faces) {
    renderFace(page, face, caller, gone?.get(face.faceId), graphs?.get(face.faceId), out);
  }
}

export interface TextsView {
  caller?: string;
  /** Pages asked for by id that the project does not have. */
  missing?: readonly string[];
  /**
   * Set when only what changed since the last read is shown: the addresses
   * that are gone since, per page and then per face.
   */
  changedOnly?: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
  /** With `changedOnly`, the graphs drawn differently since, per page and face; a whole read draws every one. */
  graphs?: ReadonlyMap<string, ReadonlyMap<string, string>>;
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
    const graphs = view.changedOnly ? view.graphs?.get(page.pageId) : graphsOf(page);
    renderPage(page, view.caller, view.changedOnly?.get(page.pageId), graphs, out);
  }
  return out.join("\n");
}

function graphsOf(page: PageTexts): Map<string, string> {
  return new Map(page.faces.flatMap((face) => (face.sentences.length > 0 ? [[face.faceId, renderMermaid(face)]] : [])));
}

/**
 * Which sentences a face holds and which lines join them, short of the words:
 * a retranslation alone does not send the whole graph again.
 */
function shapeOf(face: FaceTexts): string {
  return JSON.stringify([face.sentences.map((s) => s.no), face.edges]);
}

interface SeenFace {
  /** Each sentence as rendered, by number. */
  sentences: Map<number, string>;
  /** Absent until a whole read of the face: a write's reply holds only what it touched. */
  shape?: string;
}

/** What one session last read, per page and face. */
export type SeenTexts = Map<string, Map<string, SeenFace>>;

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
        held = { sentences: new Map() };
        faces.set(face.faceId, held);
      }
      if (whole) held.shape = shapeOf(face);
      for (const sentence of face.sentences) held.sentences.set(sentence.no, renderSentence(sentence, caller));
    }
  }
}

/**
 * These pages cut down to the sentences that read differently from the last
 * time this session saw them, one never seen counting as changed, plus the
 * addresses seen before that are no longer there, and the graph of every face
 * whose lines or sentences are not the ones last drawn. A page with none of
 * these is left out; a damaged page is kept, since its badge is the change
 * worth saying.
 *
 * ⚠️ A write's reply is a read too, so the caller's own writes do not come
 * back as changes — only what somebody else did since.
 */
export function sinceSeen(
  seen: SeenTexts,
  pages: readonly PageTexts[],
  caller: string | undefined,
): {
  pages: PageTexts[];
  gone: Map<string, Map<string, string[]>>;
  graphs: Map<string, Map<string, string>>;
} {
  const changed: PageTexts[] = [];
  const gone = new Map<string, Map<string, string[]>>();
  const graphs = new Map<string, Map<string, string>>();
  for (const page of pages) {
    const heldFaces = seen.get(page.pageId);
    const faces: FaceTexts[] = [];
    const lostHere = new Map<string, string[]>();
    const redrawn = new Map<string, string>();
    for (const face of page.faces) {
      const held = heldFaces?.get(face.faceId);
      const sentences = face.sentences.filter((s) => held?.sentences.get(s.no) !== renderSentence(s, caller));
      const here = new Set(face.sentences.map((s) => s.no));
      const lost =
        page.badge === "ok" && held
          ? [...held.sentences.keys()].filter((no) => !here.has(no)).map((no) => `${page.pageId}/${no}`)
          : [];
      const reshaped = face.sentences.length > 0 && held?.shape !== shapeOf(face);
      if (lost.length > 0) lostHere.set(face.faceId, lost);
      if (reshaped) redrawn.set(face.faceId, renderMermaid(face));
      if (sentences.length > 0 || lost.length > 0 || reshaped) faces.push({ ...face, sentences });
    }
    if (lostHere.size > 0) gone.set(page.pageId, lostHere);
    if (redrawn.size > 0) graphs.set(page.pageId, redrawn);
    if (faces.length > 0 || page.badge !== "ok") changed.push({ ...page, faces });
  }
  return { pages: changed, gone, graphs };
}

/**
 * Which object each address this session was shown stood for, by face.
 *
 * Numbers are never reissued, so an address either still names the thing the
 * session saw or names nothing — and a write that quotes one the page has
 * since regrouped is caught here rather than landing somewhere else.
 */
export type RefMemory = Map<string, Map<string, string>>;

export function noteRefs(memory: RefMemory, pages: readonly PageTexts[]): void {
  for (const page of pages) {
    for (const face of page.faces) {
      let held = memory.get(face.faceId);
      if (!held) {
        held = new Map();
        memory.set(face.faceId, held);
      }
      for (const sentence of face.sentences) {
        for (const block of sentence.blocks) {
          for (const ref of block.refs) {
            held.set(ref, block.id);
            for (const candidate of block.candidates) held.set(`${ref}${candidate.letter}`, candidate.id);
          }
        }
      }
    }
  }
}

/**
 * What this address stood for in each face that ever showed it. A face written
 * in the address is looked past here: listings spell refs without one, and the
 * caller picks the face it resolves in.
 */
export function seenIdsFor(memory: RefMemory, ref: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let any = false;
  const spelled = withoutFace(ref);
  for (const [faceId, held] of memory) {
    const id = held.get(spelled);
    if (id !== undefined) {
      out[faceId] = id;
      any = true;
    }
  }
  return any ? out : undefined;
}

function withStates(head: string[], pages: PageTexts[], caller: string | undefined): string {
  if (pages.length > 0) {
    head.push("", "操作後的狀態：");
    for (const page of pages) renderPage(page, caller, undefined, undefined, head);
  }
  return head.join("\n");
}

export function renderProposeResult(result: WriteResult<ProposeOutcome>, caller?: string): string {
  const taken = result.outcomes.filter((o) => o.ok);
  const out: string[] = [`收下 ${taken.length} 則，拒絕 ${result.outcomes.length - taken.length} 則`];
  for (const o of result.outcomes) {
    out.push(
      o.ok
        ? `${o.ref} → 候選 ${o.candidateRef}` + (o.filledSlot ? "（已生效）" : "（進入抽屜，現值未動）")
        : `${o.ref} ✗ ${o.reason}`,
    );
  }
  return withStates(out, result.pages, caller);
}

export function renderChooseResult(result: WriteResult<ChooseOutcome>, caller?: string): string {
  const out = result.outcomes.map((o) => (o.ok ? `${o.ref} 現在是現值` : `${o.ref} ✗ ${o.reason}`));
  return withStates(out, result.pages, caller);
}

export function renderWithdrawResult(result: WriteResult<WithdrawOutcome>, caller?: string): string {
  const out = result.outcomes.map((o) =>
    o.ok
      ? `${o.ref} 已撤回` + (o.clearedSlot ? "（原為現值，方塊已回退為自己的字）" : "（現值未動）")
      : `${o.ref} ✗ ${o.reason}`,
  );
  return withStates(out, result.pages, caller);
}
