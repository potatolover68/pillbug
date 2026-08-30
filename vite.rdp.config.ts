import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: "dist-rdp",
    emptyOutDir: true,
    minify: true,
    lib: {
      entry: path.resolve(rootDir, "pack/rdp/entry.ts"),
      name: "pillbugRdp",
      formats: ["iife"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      output: {
        extend: true,
        banner: `// {{Wikipedia:USync|repo=https://github.com/potatolover68/pillbug|ref=refs/heads/rdp|path=index.js}}
/* pillbug - GPL-3.0-or-later - https://github.com/potatolover68/pillbug */`,
      },
    },
  },
});
