import { defineConfig } from "electron-vite";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

const sharedAlias = {
  "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
};

/**
 * Fails the build when a bundle leaves a name for someone else to resolve.
 *
 * A package ships `out/` and no node_modules, so anything still unresolved is
 * an import that dies at startup. Rollup's own chunk metadata is what answers
 * this — reading the emitted text instead would be a second implementation of
 * the question, and one that matches nothing reads the same as one that finds
 * nothing wrong.
 */
function externalsAre(...expected: string[]): Plugin {
  const wanted = [...expected].sort().join(", ");
  return {
    name: "shashoku:externals-are",
    generateBundle(_options, bundle) {
      const chunks = Object.keys(bundle);
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        const got = [...chunk.imports, ...chunk.dynamicImports]
          .filter((id) => !chunks.includes(id) && !isBuiltin(id))
          .sort()
          .join(", ");
        if (got !== wanted) {
          this.error(`${chunk.fileName} expects [${got}] from outside, wanted [${wanted}]`);
        }
      }
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    plugins: [externalsAre("electron")],
    build: {
      outDir: "out/main",
      lib: { entry: "electron/index.ts" },
      externalizeDeps: false,
    },
  },
  preload: {
    resolve: { alias: sharedAlias },
    plugins: [externalsAre("electron")],
    build: {
      outDir: "out/preload",
      lib: { entry: "electron/preload/index.ts", formats: ["cjs"] },
      externalizeDeps: false,
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
    plugins: [
      tailwindcss(),
      vue({
        template: { compilerOptions: { isCustomElement: (tag) => tag === "hex-color-picker" } },
      }),
    ],
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: "index.html" },
    },
  },
});
