import { defineConfig } from "electron-vite";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      lib: { entry: "electron/index.ts" },
    },
  },
  preload: {
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
      },
    },
    plugins: [tailwindcss(), vue()],
    build: {
      outDir: "out/renderer",
      rollupOptions: { input: "index.html" },
    },
  },
});
