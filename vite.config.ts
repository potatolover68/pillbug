import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import {
  mediawikiApiProxy,
  mediawikiRestProxy,
  mediawikiProxyPlugin,
} from "./src/wiki/proxy.js";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** In dev, serve the AI pack entry at /ai.js (production emits dist/ai.js). */
function aiPackDevPlugin(): Plugin {
  return {
    name: "pillbug-ai-pack-dev",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url ?? "";
        if (url === "/ai.js" || url.startsWith("/ai.js?")) {
          const qs = url.includes("?") ? url.slice(url.indexOf("?")) : "";
          req.url = `/packs/ai/src/index.ts${qs}`;
        }
        next();
      });
    },
  };
}

const publicAiProxy = {
  target: "https://api.publicai.co",
  changeOrigin: true,
  secure: true,
  rewrite: (p: string) => p.replace(/^\/publicai/, "/v1"),
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    mediawikiProxyPlugin(),
    aiPackDevPlugin(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      devOptions: {
        enabled: true,
      },
    }),
  ],
  build: {
    rollupOptions: {
      // Keep `export { pack }` on the AI pack entry (otherwise Rollup treats it as an app chunk).
      preserveEntrySignatures: "strict",
      input: {
        main: path.resolve(rootDir, "index.html"),
        ai: path.resolve(rootDir, "packs/ai/src/index.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "ai" ? "ai.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    proxy: {
      "/w/api.php": mediawikiApiProxy(),
      "/w/rest.php": mediawikiRestProxy(),
      "/publicai": publicAiProxy,
    },
  },
  preview: {
    proxy: {
      "/w/api.php": mediawikiApiProxy(),
      "/w/rest.php": mediawikiRestProxy(),
      "/publicai": publicAiProxy,
    },
  },
});
