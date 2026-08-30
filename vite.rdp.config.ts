import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const RDP_BANNER = `// {{Wikipedia:USync|repo=https://github.com/potatolover68/pillbug|ref=refs/heads/rdp|path=index.js}}
/*! pillbug - GPL-3.0-or-later - https://github.com/potatolover68/pillbug */`;
function rdpBannerPlugin(): Plugin {
  return {
    name: "rdp-banner",
    writeBundle(options, bundle) {
      const outDir = options.dir ?? path.resolve(rootDir, "dist-rdp");
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.endsWith(".js")) continue;
        const filePath = path.join(outDir, fileName);
        const code = fs.readFileSync(filePath, "utf8");
        if (code.startsWith(RDP_BANNER)) continue;
        fs.writeFileSync(filePath, `${RDP_BANNER}\n${code}`);
      }
    },
  };
}

export default defineConfig({
  plugins: [rdpBannerPlugin()],
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
      },
    },
  },
});
