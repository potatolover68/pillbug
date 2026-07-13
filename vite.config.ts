import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import {
  mediawikiApiProxy,
  mediawikiRestProxy,
  mediawikiProxyPlugin,
} from "./src/wiki/proxy.js";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    mediawikiProxyPlugin(),
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
  server: {
    proxy: {
      "/w/api.php": mediawikiApiProxy(),
      "/w/rest.php": mediawikiRestProxy(),
    },
  },
  preview: {
    proxy: {
      "/w/api.php": mediawikiApiProxy(),
      "/w/rest.php": mediawikiRestProxy(),
    },
  },
});
