// Undo/redo 歷史——command pattern:每步存一對 {undo, redo} 閉包,不 clone
// 文件(每層 buffer 十幾 MB,快照式歷史吃不消;BitMappery 同款取捨)。
// 「先做、再記」:push 不執行 redo,呼叫端做完變更後才記錄。

export interface HistoryEntry {
  label: string;
  undo: () => void;
  redo: () => void;
  /** 同 key 且落在合併窗內的連續步合併為一步(滑桿拖曳這類連續微調)。 */
  mergeKey?: string;
}

interface StoredEntry extends HistoryEntry {
  at: number;
}

const MERGE_WINDOW_MS = 1000;

export class History {
  private undoStack: StoredEntry[] = [];
  private redoStack: StoredEntry[] = [];

  constructor(
    private cap = 40,
    private now: () => number = () => Date.now(),
  ) {}

  push(entry: HistoryEntry): void {
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      entry.mergeKey !== undefined &&
      top?.mergeKey === entry.mergeKey &&
      this.now() - top.at < MERGE_WINDOW_MS
    ) {
      // 合併:undo 留最早的(一步回到起點),redo 換最新的(一步到最新值)。
      top.redo = entry.redo;
      top.at = this.now();
      return;
    }
    this.undoStack.push({ ...entry, at: this.now() });
    if (this.undoStack.length > this.cap) this.undoStack.shift();
  }

  undo(): boolean {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    entry.undo();
    this.redoStack.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    entry.redo();
    this.undoStack.push(entry);
    return true;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 下一步 undo 的標籤(UI 顯示「復原 ○○」用);無則 null。 */
  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
