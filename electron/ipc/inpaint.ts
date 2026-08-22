import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ipcMain } from "electron";
import { CHANNELS } from "@shared/ipc/channels";
import type { InpaintRequest, InpaintResult } from "@shared/inpaint/types";
import { ocrSidecar } from "../lib/ocrSidecar";

/**
 * Retouching, with the files the models want made and destroyed here.
 *
 * The renderer hands over encoded pictures and gets one back; it never learns a
 * path. That is not tidiness — a region being retouched has never been on disk
 * and has no name, so any name is one this process invented, and a name the
 * renderer could hold would outlive the request that justified it.
 *
 * A directory per request rather than a shared scratch: two of these can be in
 * the air at once, and names that collide would have one request answer with
 * the other's picture.
 */
export function registerInpaintHandlers() {
  const engine = ocrSidecar();

  ipcMain.handle(CHANNELS.inpaintErase, async (_event, request: InpaintRequest) => {
    const folder = await mkdtemp(join(tmpdir(), "shashoku-inpaint-"));
    try {
      const image = join(folder, "image.png");
      const mask = join(folder, "mask.png");
      const out = join(folder, "out.png");
      await writeFile(image, request.image);
      await writeFile(mask, request.mask);
      const answer = await engine.inpaint(image, mask, out);
      const done: InpaintResult = {
        image: await readFile(out),
        width: answer.width,
        height: answer.height,
      };
      return done;
    } finally {
      // Whatever happened, the pictures do not stay. A failure is the case that
      // would otherwise leave someone's artwork in the system temp folder.
      await rm(folder, { recursive: true, force: true }).catch(() => {});
    }
  });
}
