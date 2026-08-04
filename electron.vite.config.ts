import { defineConfig } from "electron-vite";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

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
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        // The published bundle is built against an older Vue 3 and drags in its
        // own copy; the source entry compiles against ours.
        vuedraggable: "vuedraggable/src/vuedraggable.js",
        ...sharedAlias,
      },
    },
    plugins: [tailwindcss(), vue()],
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: "index.html" },
    },
  },
});
