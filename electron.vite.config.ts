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
        output: { entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    root: ".",
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
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
