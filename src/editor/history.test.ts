import { describe, expect, it } from "vitest";
import { History, type HistoryEntry } from "./history";

function entry(log: string[], tag: string, mergeKey?: string): HistoryEntry {
  return {
    label: tag,
    mergeKey,
    undo: () => log.push(`undo:${tag}`),
    redo: () => log.push(`redo:${tag}`),
  };
}

describe("History", () => {
  it("push 不執行 redo;undo/redo 依序執行對應閉包", () => {
    const log: string[] = [];
    const h = new History();
    h.push(entry(log, "a"));
    h.push(entry(log, "b"));
    expect(log).toEqual([]); // 先做再記:push 本身不觸發任何執行

    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(false); // 見底
    expect(log).toEqual(["undo:b", "undo:a"]);

    expect(h.redo()).toBe(true);
    expect(log).toEqual(["undo:b", "undo:a", "redo:a"]);
    expect(h.canRedo).toBe(true);
    expect(h.redoLabel).toBe("b");
  });

  it("undo 後再 push 會清空 redo 分支", () => {
    const log: string[] = [];
    const h = new History();
    h.push(entry(log, "a"));
    h.undo();
    expect(h.canRedo).toBe(true);
    h.push(entry(log, "b"));
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(false);
  });

  it("超過上限時淘汰最舊的一步", () => {
    const log: string[] = [];
    const h = new History(2);
    h.push(entry(log, "a"));
    h.push(entry(log, "b"));
    h.push(entry(log, "c"));
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(false); // a 已被淘汰
    expect(log).toEqual(["undo:c", "undo:b"]);
  });

  it("同 mergeKey 且在合併窗內收成一步:undo 回起點、redo 到最新", () => {
    const log: string[] = [];
    let t = 0;
    const h = new History(40, () => t);
    h.push(entry(log, "op1", "opacity:x"));
    t = 500;
    h.push(entry(log, "op2", "opacity:x"));

    expect(h.undo()).toBe(true);
    expect(h.undo()).toBe(false); // 合併成單一步
    expect(log).toEqual(["undo:op1"]); // undo 用最早的

    h.redo();
    expect(log).toEqual(["undo:op1", "redo:op2"]); // redo 用最新的
  });

  it("同 mergeKey 但超出合併窗則不合併", () => {
    const log: string[] = [];
    let t = 0;
    const h = new History(40, () => t);
    h.push(entry(log, "op1", "opacity:x"));
    t = 1500;
    h.push(entry(log, "op2", "opacity:x"));
    h.undo();
    h.undo();
    expect(log).toEqual(["undo:op2", "undo:op1"]);
  });

  it("不同 mergeKey 不合併;無 mergeKey 永不合併", () => {
    const log: string[] = [];
    let t = 0;
    const h = new History(40, () => t);
    h.push(entry(log, "a", "k1"));
    h.push(entry(log, "b", "k2"));
    h.push(entry(log, "c"));
    h.push(entry(log, "d"));
    h.undo();
    h.undo();
    h.undo();
    h.undo();
    expect(log).toEqual(["undo:d", "undo:c", "undo:b", "undo:a"]);
  });
});
