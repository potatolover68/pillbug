<script setup lang="ts">
import {
  TABS,
  activeTab,
  changelogOpen,
  setActiveTab,
  toggleChangelog,
  type AppTab,
} from "./tabs";
import AboutLinks from "./AboutLinks.vue";
import ProjectPanel from "./ProjectPanel.vue";
import "./sidebar.css";
</script>

<template>
  <aside class="pillbug-sidebar sidebar-shell">
    <div class="tab-bar">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        class="tab-btn"
        type="button"
        :class="{ active: activeTab === tab.id }"
        :title="tab.label"
        @click="setActiveTab(tab.id as AppTab)"
      >
        <span class="tab-label">{{ tab.label }}</span>
      </button>
      <button
        class="help-btn"
        type="button"
        title="Changelog"
        :class="{ active: changelogOpen }"
        @click="toggleChangelog"
      >
        ?
      </button>
    </div>

    <div class="pillbug-sidebar-body">
      <slot />
    </div>

    <AboutLinks />
    <ProjectPanel />
  </aside>
</template>

<style scoped>
.sidebar-shell {
  width: var(--sidebar-width);
}

.tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  padding: var(--pad);
  border-bottom: 1px solid var(--panel-border);
  flex-shrink: 0;
}

.tab-btn,
.help-btn {
  height: var(--row-h);
  padding: 0 4px;
  border: none;
  border-radius: 2px;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font: inherit;
  line-height: 1;
  cursor: pointer;
}

.tab-btn {
  flex: 1;
  min-width: 0;
}

.tab-btn.active,
.help-btn.active {
  color: #fff;
  outline: 1px solid var(--accent);
  outline-offset: -1px;
  background: rgba(245, 166, 35, 0.08);
}

.tab-btn:hover:not(.active),
.help-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.help-btn {
  flex: none;
  width: 20px;
}

.tab-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
</style>
