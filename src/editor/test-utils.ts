// actions 測試的共用腳手架(僅供 *.test.ts 引用)。
import { vi, type Mock } from "vitest";
import { ShashokuDoc } from "@/engine/document";
import { History } from "./history";
import type { EditorCtx } from "./types";

interface TestCtx {
  ctx: EditorCtx;
  doc: ShashokuDoc;
  history: History;
  changed: Mock;
}

export function makeCtx(layerNames: string[] = ["底圖"], w = 8, h = 8): TestCtx {
  const doc = new ShashokuDoc(w, h);
  for (const name of layerNames) doc.addBlankLayer(name);
  const history = new History();
  const changed = vi.fn();
  const ctx: EditorCtx = { doc, history, changed };
  return { ctx, doc, history, changed };
}

export function layerNames(doc: ShashokuDoc): string[] {
  return doc.layers.map((l) => l.name);
}
