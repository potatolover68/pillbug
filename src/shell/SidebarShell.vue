<script setup lang="ts">
import {
  TABS,
  activeTab,
  canCollapseSidebar,
  setActiveTab,
  toggleSidebar,
  type AppTab,
} from "./tabs";
import AboutLinks from "./AboutLinks.vue";
import ProjectPanel from "./ProjectPanel.vue";
import "./sidebar.css";

defineProps<{
  collapsed: boolean;
}>();
</script>

<template>
  <aside class="pillbug-sidebar sidebar-shell" :class="{ collapsed }">
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
        <span class="tab-label">{{
          collapsed ? tab.label[0] : tab.label
        }}</span>
      </button>
      <button
        class="collapse-btn"
        type="button"
        :disabled="!canCollapseSidebar"
        :title="collapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="toggleSidebar"
      >
        {{ collapsed ? "»" : "«" }}
      </button>
    </div>

    <div v-show="!collapsed" class="pillbug-sidebar-body">
      <slot />
    </div>

    <AboutLinks v-show="!collapsed" />
    <ProjectPanel v-show="!collapsed" />
  </aside>
</template>

<style scoped>
.sidebar-shell {
  width: var(--sidebar-width);
  transition: width 0.12s ease;
}

.sidebar-shell.collapsed {
  width: var(--sidebar-collapsed-width);
}

.tab-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  padding: var(--pad);
  border-bottom: 1px solid var(--panel-border);
  flex-shrink: 0;
}

.sidebar-shell.collapsed .tab-bar {
  flex-direction: column;
  align-items: stretch;
}

.tab-btn,
.collapse-btn {
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

.tab-btn.active {
  color: #fff;
  outline: 1px solid var(--accent);
  outline-offset: -1px;
  background: rgba(245, 166, 35, 0.08);
}

.tab-btn:hover:not(.active),
.collapse-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.collapse-btn {
  flex: none;
  width: 20px;
}

.collapse-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.tab-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
</style>
