import type { ShashokuEngineApi } from "@shared/engine/types";
import type { ShashokuInpaintApi } from "@shared/inpaint/types";
import type { ShashokuApi } from "@shared/ipc/channels";
import type { ShashokuOcrApi } from "@shared/ocr/types";

declare global {
  interface Window {
    api: ShashokuApi;
    engine: ShashokuEngineApi;
    ocr: ShashokuOcrApi;
    inpaint: ShashokuInpaintApi;
  }
}

export {};
