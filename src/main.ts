import { registerSW } from "virtual:pwa-register";
import { createApp } from "vue";
import App from "./App.vue";
import { rebuildMaps } from "./extensions/loader";
import { loadWikiConfig, restoreSession } from "./wiki/session";

registerSW({ immediate: true });

await Promise.all([rebuildMaps(), loadWikiConfig()]);
await restoreSession();

createApp(App).mount("#app");
