import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist-rdp",
    emptyOutDir: true,
    codeSplitting: false,
    lib: {
      entry: path.resolve(rootDir, "pack/rdp/entry.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      output: {
        banner:
          "/* pillbug - GPL-3.0-or-later - https://github.com/potatolover68/pillbug */",
      },
    },
  },
});
