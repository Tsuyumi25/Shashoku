import { describe, expect, it } from "vitest";
import { overBudget, type CachedFile } from "./thumbnailCache";

function file(name: string, size: number, writtenAt: number): CachedFile {
  return { name, size, writtenAt };
}

describe("overBudget", () => {
  it("lets go of nothing when the cache already fits", () => {
    const files = [file("a", 10, 3), file("b", 10, 2), file("c", 10, 1)];

    expect(overBudget(files, 100)).toEqual([]);
  });

  it("lets go of the oldest until what is left fits", () => {
    const files = [file("new", 40, 3), file("mid", 40, 2), file("old", 40, 1)];

    expect(overBudget(files, 100)).toEqual(["old"]);
  });

  it("keeps a file that lands exactly on the budget", () => {
    const files = [file("a", 50, 2), file("b", 50, 1)];

    expect(overBudget(files, 100)).toEqual([]);
  });

  it("measures in bytes rather than in files", () => {
    // The newest is alone worth more than everything under it.
    const files = [file("huge", 90, 3), file("a", 20, 2), file("b", 20, 1)];

    expect(overBudget(files, 100).sort()).toEqual(["a", "b"]);
  });

  it("answers the same way twice when two were written in the same moment", () => {
    const files = [file("b", 60, 1), file("a", 60, 1)];

    expect(overBudget(files, 100)).toEqual(["b"]);
    expect(overBudget([...files].reverse(), 100)).toEqual(["b"]);
  });

  it("empties a cache it is given no room for", () => {
    const files = [file("a", 1, 2), file("b", 1, 1)];

    expect(overBudget(files, 0).sort()).toEqual(["a", "b"]);
  });

  it("has nothing to say about an empty cache", () => {
    expect(overBudget([], 100)).toEqual([]);
  });
});
