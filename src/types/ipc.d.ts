import type { ShashokuApi } from "../../shared/ipc";

declare global {
  interface Window {
    api: ShashokuApi;
  }
}

export {};
