<script setup lang="ts">
import { onMounted } from "vue";
import {
  dualAction,
  loadDraft,
  projectBusy,
  projectError,
  projectNameDraft,
  projectStatus,
  refreshProjectList,
  saveCopy,
  saveCurrent,
} from "./projectUi";

onMounted(() => {
  void refreshProjectList();
});
</script>

<template>
  <div class="project-panel">
    <label class="panel-field">
      <span class="panel-label">Project</span>
      <input
        v-model="projectNameDraft"
        class="panel-input"
        type="text"
        autocomplete="off"
        :disabled="projectBusy"
      />
    </label>

    <div class="panel-actions">
      <button
        class="panel-btn"
        type="button"
        :disabled="projectBusy || !projectNameDraft.trim()"
        @click="saveCurrent"
      >
        Save
      </button>
      <button
        class="panel-btn"
        type="button"
        :disabled="projectBusy || !projectNameDraft.trim()"
        @click="dualAction === 'load' ? loadDraft() : saveCopy()"
      >
        {{ dualAction === "load" ? "Load" : "Save copy" }}
      </button>
    </div>

    <p v-if="projectError" class="panel-status error">{{ projectError }}</p>
    <p v-else-if="projectStatus" class="panel-status">{{ projectStatus }}</p>
  </div>
</template>

<style scoped>
.project-panel {
  display: flex;
  flex-direction: column;
  gap: var(--pad);
  flex: none;
  padding: var(--pad);
  border-top: 1px solid var(--panel-border);
}
</style>
