<script setup lang="ts">
import Config from "../tabs/config/Config.vue";
import ConfigSidebar from "../tabs/config/ConfigSidebar.vue";
import Code from "../tabs/code/Code.vue";
import CodeSidebar from "../tabs/code/CodeSidebar.vue";
import Review from "../tabs/review/Review.vue";
import ReviewSidebar from "../tabs/review/ReviewSidebar.vue";
import Changelog from "../tabs/changelog/Changelog.vue";

import SidebarShell from "./SidebarShell.vue";
import { activeTab, changelogOpen } from "./tabs";
</script>

<template>
  <div class="app-shell">
    <main class="main-pane">
      <Config v-if="activeTab === 'config'" />
      <Code v-else-if="activeTab === 'code'" />
      <Review v-else />
    </main>

    <SidebarShell>
      <ConfigSidebar v-if="activeTab === 'config'" />
      <CodeSidebar v-else-if="activeTab === 'code'" />
      <ReviewSidebar v-else />
    </SidebarShell>

    <Changelog v-if="changelogOpen" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1e2024;
}

.main-pane {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
</style>
