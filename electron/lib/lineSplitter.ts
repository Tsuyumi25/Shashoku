/**
 * Turns a byte stream into lines without waiting for `\n`.
 *
 * `readline`'s line-ending rule is `\n`, with a `\r` immediately before it
 * folded in — it never treats a lone `\r` as an ending. A progress bar redraws
 * its line with a bare `\r` and writes no `\n` until it finishes, so a reader
 * built on `readline` holds the entire download as one unterminated line and
 * only emits it once the bar closes. This treats `\r\n`, lone `\r`, and lone
 * `\n` as the same event, so each redraw comes out the moment it arrives.
 *
 * A `\r` that lands on the end of a chunk is ambiguous — the next chunk might
 * open with `\n`, making it one `\r\n` ending rather than two — so it is held
 * back until more input (or `flush`) resolves it.
 */
export class LineSplitter {
  private buffer = "";

  /** Feeds in the next chunk, returning whatever complete lines it produced. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let start = 0;
    let i = 0;
    for (; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch === "\n") {
        lines.push(this.buffer.slice(start, i));
        start = i + 1;
      } else if (ch === "\r") {
        if (i + 1 >= this.buffer.length) {
          // Could still turn into `\r\n` once the next chunk arrives.
          break;
        }
        lines.push(this.buffer.slice(start, i));
        if (this.buffer[i + 1] === "\n") i++;
        start = i + 1;
      }
    }
    this.buffer = this.buffer.slice(start);
    return lines;
  }

  /** Whatever is left with no terminator after it, as a final line. */
  flush(): string[] {
    let remaining = this.buffer;
    this.buffer = "";
    // A trailing `\r` was only ever held back in case `\n` followed it; the
    // stream is over, so it never will, and the `\r` itself was the ending.
    if (remaining.endsWith("\r")) remaining = remaining.slice(0, -1);
    return remaining.length > 0 ? [remaining] : [];
  }
}
