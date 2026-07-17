import { protocol } from "electron";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: "local-file", privileges: { bypassCSP: true, stream: true } },
  ]);
}

// 直接走 fs stream + Response，不過 net.fetch / file:// scheme。
// 不繞 net.fetch 的兩個理由：
// 1. chromium 對 file:// 是 special scheme，對含 %23 等保留字的 URL 會在 scheme
//    normalization 階段直接判定 invalid（ERR_FAILED），即使 URL 已正確 encode。
// 2. main↔renderer 透過 net.fetch proxy 對大檔案有顯著延遲（electron#42612）。
export function handleLocalFileProtocol(): void {
  protocol.handle("local-file", async (request) => {
    try {
      const filePath = fileURLToPath(request.url.replace(/^local-file:/, "file:"));
      const info = await stat(filePath);
      if (!info.isFile()) return new Response(null, { status: 404 });
      return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
        status: 200,
        headers: { "content-length": String(info.size) },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
