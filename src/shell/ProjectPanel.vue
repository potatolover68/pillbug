<script setup lang="ts">
import { onMounted, ref } from "vue";
import { listProjects, loadProject, saveProject } from "../io/projects";

const projectName = ref("default");
const projectNames = ref<string[]>([]);
const status = ref<string | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);

async function refreshList(): Promise<void> {
  projectNames.value = await listProjects();
}

async function onSave(): Promise<void> {
  const name = projectName.value.trim();
  if (!name) return;
  busy.value = true;
  error.value = null;
  try {
    await saveProject(name);
    status.value = `Saved “${name}”`;
    await refreshList();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

async function onLoad(): Promise<void> {
  const name = projectName.value.trim();
  if (!name) return;
  busy.value = true;
  error.value = null;
  try {
    const warnings = await loadProject(name);
    status.value =
      warnings.length > 0
        ? `Loaded “${name}” (${warnings.length} warning(s))`
        : `Loaded “${name}”`;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void refreshList();
});
</script>

<template>
  <div class="project-panel">
    <label class="panel-field">
      <span class="panel-label">Project</span>
      <input
        v-model="projectName"
        class="panel-input"
        type="text"
        list="pillbug-project-names"
        autocomplete="off"
      />
      <datalist id="pillbug-project-names">
        <option v-for="name in projectNames" :key="name" :value="name" />
      </datalist>
    </label>

    <div class="panel-actions">
      <button
        class="panel-btn"
        type="button"
        :disabled="busy || !projectName.trim()"
        @click="onSave"
      >
        Save
      </button>
      <button
        class="panel-btn"
        type="button"
        :disabled="busy || !projectName.trim()"
        @click="onLoad"
      >
        Load
      </button>
    </div>

    <p v-if="error" class="panel-status error">{{ error }}</p>
    <p v-else-if="status" class="panel-status">{{ status }}</p>
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
