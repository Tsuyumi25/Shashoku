import type { ShashokuEngineApi } from "@shared/engine/types";
import type { ShashokuApi } from "@shared/ipc/channels";

declare global {
  interface Window {
    api: ShashokuApi;
    engine: ShashokuEngineApi;
  }
}

export {};
