import { defineConfig } from "electron-vite";
import { fileURLToPath } from "node:url";

const sharedAlias = {
  "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
};

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: "out/main",
      lib: { entry: "electron/index.ts" },
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      outDir: "out/preload",
      lib: { entry: "electron/preload/index.ts", formats: ["cjs"] },
      rollupOptions: {
        output: { entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: ".",
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: "index.html" },
    },
  },
});
