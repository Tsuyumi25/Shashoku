import type { ShashokuDoc } from "@/engine/document";
import type { History } from "./history";

/**
 * Actions 的執行環境。actions 是唯一合法的「改文件結構」入口:每個 action
 * 完成變更 + 向 history 註冊 {undo, redo},再呼叫 changed() 讓 UI 重繪/同步。
 * UI(面板、快捷鍵)只呼叫 action,不直接改 doc。
 */
export interface EditorCtx {
  doc: ShashokuDoc;
  history: History;
  /** 變更通知:UI 據此重繪 canvas 並同步圖層列表等衍生狀態。 */
  changed: () => void;
}
