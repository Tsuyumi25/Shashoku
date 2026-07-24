import type { ShashokuApi } from "@shared/ipc/channels";

declare global {
  interface Window {
    api: ShashokuApi;
  }
}

export {};
