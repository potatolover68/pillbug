<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { SaveCopyMode } from "../../io/projects";
import {
  currentProjectName,
  deleteAllNamed,
  deleteNamed,
  exportAllProjects,
  exportNamed,
  importFromFile,
  loadNamed,
  projectBusy,
  projectRecords,
  refreshProjectList,
  saveCopyMode,
  updateSaveCopyMode,
} from "../../shell/projectUi";

const search = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return projectRecords.value;
  return projectRecords.value.filter((r) => r.name.toLowerCase().includes(q));
});

function formatUpdated(ts: number): string {
  return new Date(ts).toLocaleString();
}

function onModeChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value as SaveCopyMode;
  updateSaveCopyMode(value);
}

function onImportClick(): void {
  fileInput.value?.click();
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) await importFromFile(file);
}

onMounted(() => {
  void refreshProjectList();
});
</script>

<template>
  <div class="projects-block">
    <label class="panel-field">
      <span class="panel-label">Save copy mode</span>
      <select
        class="panel-input"
        :value="saveCopyMode"
        :disabled="projectBusy"
        @change="onModeChange"
      >
        <option value="timestamp">Timestamp</option>
        <option value="incremental">Incremental</option>
        <option value="copy">Append “copy”</option>
      </select>
    </label>

    <div class="projects-toolbar">
      <input
        v-model="search"
        class="panel-input search-input"
        type="search"
        placeholder="Search projects…"
        autocomplete="off"
      />
      <button
        class="panel-btn"
        type="button"
        :disabled="projectBusy"
        @click="onImportClick"
      >
        Import
      </button>
      <input
        ref="fileInput"
        class="file-input"
        type="file"
        accept="application/json,.json,application/zip,.zip"
        @change="onFileChange"
      />
    </div>

    <div class="projects-bulk">
      <button
        class="panel-btn"
        type="button"
        :disabled="projectBusy || projectRecords.length === 0"
        @click="exportAllProjects"
      >
        Export all
      </button>
      <button
        class="panel-btn danger-btn"
        type="button"
        :disabled="projectBusy || projectRecords.length === 0"
        @click="deleteAllNamed"
      >
        Delete all
      </button>
    </div>

    <ul v-if="filtered.length > 0" class="project-list">
      <li
        v-for="entry in filtered"
        :key="entry.name"
        class="project-item"
        :class="{ current: entry.name === currentProjectName }"
      >
        <button
          class="project-main"
          type="button"
          :disabled="projectBusy"
          @click="loadNamed(entry.name)"
        >
          <span class="project-name">{{ entry.name }}</span>
          <time class="project-time" :datetime="String(entry.updatedAt)">
            {{ formatUpdated(entry.updatedAt) }}
          </time>
        </button>
        <div class="project-actions">
          <button
            class="action-btn"
            type="button"
            title="Export"
            :disabled="projectBusy"
            @click="exportNamed(entry.name)"
          >
            Export
          </button>
          <button
            class="action-btn danger"
            type="button"
            title="Delete"
            :disabled="projectBusy"
            @click="deleteNamed(entry.name)"
          >
            Delete
          </button>
        </div>
      </li>
    </ul>
    <p v-else class="empty">No projects</p>
  </div>
</template>

<style scoped>
.projects-block {
  display: flex;
  flex-direction: column;
  gap: var(--pad);
  flex: 1;
  min-height: 0;
  margin-top: var(--pad);
  padding-top: var(--pad);
  border-top: 1px solid var(--panel-border);
}

.projects-toolbar {
  display: flex;
  gap: 2px;
  align-items: center;
}

.search-input {
  flex: 1;
  min-width: 0;
  width: auto;
}

.projects-toolbar .panel-btn {
  flex: none;
  padding: 0 8px;
}

.projects-bulk {
  display: flex;
  gap: 2px;
}

.projects-bulk .danger-btn:hover:not(:disabled) {
  color: #ffb4b4;
}

.file-input {
  display: none;
}

.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.project-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.2);
}

.project-item.current .project-main {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
  background: rgba(245, 166, 35, 0.08);
}

.project-main {
  display: block;
  width: 100%;
  padding: 2px 4px;
  text-align: left;
  background: none;
  border: none;
  border-radius: 2px;
  cursor: pointer;
  font: inherit;
  color: inherit;
}

.project-main:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.06);
}

.project-main:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.project-name {
  display: block;
  line-height: var(--row-h);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-time {
  display: block;
  color: var(--panel-muted);
  font-size: 10px;
  line-height: var(--row-h);
}

.project-actions {
  display: flex;
  gap: 2px;
  padding: 0 4px 2px;
}

.action-btn {
  flex: 1;
  height: var(--row-h);
  padding: 0 4px;
  border: 1px solid var(--panel-border);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.15);
  color: var(--panel-muted);
  font: inherit;
  cursor: pointer;
}

.action-btn:hover:not(:disabled) {
  color: var(--panel-text);
  background: rgba(255, 255, 255, 0.08);
}

.action-btn.danger:hover:not(:disabled) {
  color: #ffb4b4;
}

.action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.empty {
  margin: 0;
  color: var(--panel-muted);
}
</style>
