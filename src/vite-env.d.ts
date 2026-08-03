/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision?: string }>;
};

interface Window {
  /** Testing: set `true` to show the Bot checkbox without a MW bot group. */
  __PILLBUG_SPOOF_BOT__?: boolean;
}
