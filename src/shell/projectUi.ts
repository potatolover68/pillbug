import { computed, ref } from "vue";
import {
  deleteAllProjects,
  deleteProject,
  getAllProjects,
  getProject,
  getSaveCopyMode,
  importProject,
  listProjectRecords,
  loadProject,
  nextCopyName,
  packProjectsZip,
  parseProjectRecord,
  saveProject,
  setSaveCopyMode,
  unpackProjectsZip,
  type ProjectListItem,
  type SaveCopyMode,
} from "../io/projects";

export const currentProjectName = ref("default");
export const projectNameDraft = ref("default");
export const projectRecords = ref<ProjectListItem[]>([]);
export const projectBusy = ref(false);
export const projectStatus = ref<string | null>(null);
export const projectError = ref<string | null>(null);
export const saveCopyMode = ref<SaveCopyMode>(getSaveCopyMode());

export const draftMatchesCurrent = computed(
  () => projectNameDraft.value.trim() === currentProjectName.value,
);

export const dualAction = computed<"save-copy" | "load">(() =>
  draftMatchesCurrent.value ? "save-copy" : "load",
);

export async function refreshProjectList(): Promise<void> {
  projectRecords.value = await listProjectRecords();
}

export function updateSaveCopyMode(mode: SaveCopyMode): void {
  saveCopyMode.value = mode;
  setSaveCopyMode(mode);
}

function setCurrentName(name: string): void {
  currentProjectName.value = name;
  projectNameDraft.value = name;
}

export async function saveCurrent(): Promise<void> {
  const name = projectNameDraft.value.trim();
  if (!name || projectBusy.value) return;
  projectBusy.value = true;
  projectError.value = null;
  try {
    await saveProject(name);
    setCurrentName(name);
    projectStatus.value = `Saved “${name}”`;
    await refreshProjectList();
  } catch (err) {
    projectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    projectBusy.value = false;
  }
}

export async function saveCopy(): Promise<void> {
  const base = currentProjectName.value.trim();
  if (!base || projectBusy.value) return;
  projectBusy.value = true;
  projectError.value = null;
  try {
    await refreshProjectList();
    const names = projectRecords.value.map((r) => r.name);
    const copyName = nextCopyName(base, saveCopyMode.value, names);
    await saveProject(copyName);
    setCurrentName(copyName);
    projectStatus.value = `Saved copy “${copyName}”`;
    await refreshProjectList();
  } catch (err) {
    projectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    projectBusy.value = false;
  }
}

export async function loadNamed(name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed || projectBusy.value) return;
  projectBusy.value = true;
  projectError.value = null;
  try {
    const warnings = await loadProject(trimmed);
    setCurrentName(trimmed);
    projectStatus.value =
      warnings.length > 0
        ? `Loaded “${trimmed}” (${warnings.length} warning(s))`
        : `Loaded “${trimmed}”`;
    await refreshProjectList();
  } catch (err) {
    projectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    projectBusy.value = false;
  }
}

export async function loadDraft(): Promise<void> {
  await loadNamed(projectNameDraft.value);
}

export async function deleteNamed(name: string): Promise<void> {
  if (!name || projectBusy.value) return;
  if (!window.confirm(`Delete project “${name}”?`)) return;
  projectBusy.value = true;
  projectError.value = null;
  try {
    await deleteProject(name);
    projectStatus.value = `Deleted “${name}”`;
    await refreshProjectList();
  } catch (err) {
    projectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    projectBusy.value = false;
  }
}

export async function exportNamed(name: string): Promise<void> {
  if (!name || projectBusy.value) return;
  projectBusy.value = true;
  projectError.value = null;
  try {
    const record = await getProject(name);
    const blob = new Blob([JSON.stringify(record, null, 2)], {
      type: "application/json",
    });
    downloadBlob(blob, `pillbug-${name}.json`);
    projectStatus.value = `Exported “${name}”`;
  } catch (err) {
    projectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    projectBusy.value = false;
  }
}

export async function exportAllProjects(): Promise<void> {
  if (projectBusy.value) return;
  projectBusy.value = true;
  projectError.value = null;
  try {
    const records = await getAllProjects();
    if (records.length === 0) {
      projectStatus.value = "No projects to export";
      return;
    }
    const zipped = packProjectsZip(records);
    const copy = new Uint8Array(zipped.byteLength);
    copy.set(zipped);
    const blob = new Blob([copy], { type: "application/zip" });
    const stamp = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replace(/:/g, "-");
    downloadBlob(blob, `pillbug-projects-${stamp}.zip`);
    projectStatus.value = `Exported ${records.length} project(s)`;
  } catch (err) {
    projectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    projectBusy.value = false;
  }
}

export async function deleteAllNamed(): Promise<void> {
  if (projectBusy.value) return;
  const count = projectRecords.value.length;
  if (count === 0) {
    projectStatus.value = "No projects to delete";
    return;
  }
  if (
    !window.confirm(`Delete all ${count} project(s)? This cannot be undone.`)
  ) {
    return;
  }
  projectBusy.value = true;
  projectError.value = null;
  try {
    const deleted = await deleteAllProjects();
    projectStatus.value = `Deleted ${deleted} project(s)`;
    await refreshProjectList();
  } catch (err) {
    projectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    projectBusy.value = false;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".zip") ||
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed"
  );
}

export async function importFromFile(file: File): Promise<void> {
  if (projectBusy.value) return;
  projectBusy.value = true;
  projectError.value = null;
  try {
    if (isZipFile(file)) {
      const buffer = new Uint8Array(await file.arrayBuffer());
      const records = unpackProjectsZip(buffer);
      const names: string[] = [];
      for (const record of records) {
        names.push(await importProject(record));
      }
      projectStatus.value = `Imported ${names.length} project(s)`;
    } else {
      const text = await file.text();
      const record = parseProjectRecord(JSON.parse(text) as unknown);
      const storedAs = await importProject(record);
      projectStatus.value = `Imported “${storedAs}”`;
    }
    await refreshProjectList();
  } catch (err) {
    projectError.value = err instanceof Error ? err.message : String(err);
  } finally {
    projectBusy.value = false;
  }
}
