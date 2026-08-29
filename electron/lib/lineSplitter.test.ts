import { describe, expect, it } from "vitest";
import { LineSplitter } from "./lineSplitter";

describe("LineSplitter", () => {
  it("splits on a plain \\n", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("a\nb\n")).toEqual(["a", "b"]);
  });

  it("treats \\r\\n as one line ending, not two", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("a\r\nb\r\n")).toEqual(["a", "b"]);
  });

  it("treats a lone \\r as a line ending on its own", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("a\rb\rc\n")).toEqual(["a", "b", "c"]);
  });

  it("holds a trailing \\r back until the next chunk resolves it", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("a\r")).toEqual([]);
    // The held-back \r turns out to be half of \r\n once \n arrives.
    expect(splitter.push("\nb")).toEqual(["a"]);
  });

  it("resolves a held-back \\r as its own ending when no \\n follows", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("a\r")).toEqual([]);
    expect(splitter.push("b\n")).toEqual(["a", "b"]);
  });

  it("flushes the trailing partial line once the stream ends", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("half")).toEqual([]);
    expect(splitter.flush()).toEqual(["half"]);
  });

  it("flushes nothing when the buffer is already empty", () => {
    const splitter = new LineSplitter();
    splitter.push("a\n");
    expect(splitter.flush()).toEqual([]);
  });

  it("flushes a line that ended in an unresolved \\r", () => {
    const splitter = new LineSplitter();
    splitter.push("a\r");
    expect(splitter.flush()).toEqual(["a"]);
  });

  /**
   * The property this whole module exists for: a `\r`-redrawn progress bar
   * comes out one redraw at a time, not as a single blob once the bar
   * finally closes. `readline` fails exactly this — it only ends a line on
   * `\n`, so it would hold everything below until the closing `\n` arrived.
   */
  it("gives each \\r-redraw as its own line as it arrives, not held until the end", () => {
    const splitter = new LineSplitter();

    const first = splitter.push("downloading: 10%\rdownloading: 55%\rdownloading: 90%\r");
    // The first two redraws are already resolved — no more input needed.
    expect(first).toEqual(["downloading: 10%", "downloading: 55%"]);

    const second = splitter.push("done\n");
    expect(second).toEqual(["downloading: 90%", "done"]);
  });

  it("splits multiple lines out of a single chunk with mixed endings", () => {
    const splitter = new LineSplitter();
    expect(splitter.push("a\nb\r\nc\rd")).toEqual(["a", "b", "c"]);
    expect(splitter.flush()).toEqual(["d"]);
  });
});
