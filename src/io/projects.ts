import {
  importGraph,
  serializeDocument,
  type GraphDocument,
} from "@nodish/core";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  openPillbugDB,
  type ProjectRecord,
  type ProjectWikiSnapshot,
} from "../db/open";
import {
  applyGeneratorSnapshot,
  snapshotGenerator,
  type GeneratorSnapshot,
} from "../tabs/config/generatorState";
import { editSummary } from "../tabs/review/state";
import { map, skipMap } from "../tabs/shared";
import {
  clearPreviewInputsFromMaps,
  syncPreviewInputs,
} from "../tabs/code/state";
import { clearPrefetch } from "../wiki/prefetch";
import { pageQueue, replaceQueue } from "../wiki/queue";
import { DEFAULT_USER_AGENT } from "../meta";
import {
  applyWikiOrigin,
  persistWikiConfig,
  prefetchMode,
  username,
  wikiOrigin,
} from "../wiki/session";

function collectWiki(): ProjectWikiSnapshot {
  return {
    wikiOrigin: wikiOrigin.value,
    username: username.value,
    userAgent: DEFAULT_USER_AGENT,
    prefetchMode: prefetchMode.value,
  };
}

function applyWiki(snap: ProjectWikiSnapshot): void {
  applyWikiOrigin(snap.wikiOrigin);
  username.value = snap.username;
  prefetchMode.value = snap.prefetchMode === "B" ? "B" : "A";
}

export async function saveProject(name: string): Promise<void> {
  clearPreviewInputsFromMaps();
  const db = await openPillbugDB();
  const record: ProjectRecord = {
    name,
    updatedAt: Date.now(),
    process: serializeDocument(map.value),
    skip: serializeDocument(skipMap.value),
    queue: pageQueue.value.slice(),
    generator: snapshotGenerator(),
    wiki: collectWiki(),
    editSummary: editSummary.value,
  };
  await db.put("projects", record);
  // Keep standalone wikiConfig in sync with project wiki fields.
  await persistWikiConfig();
  syncPreviewInputs();
}

export async function loadProject(name: string): Promise<string[]> {
  const db = await openPillbugDB();
  const record = await db.get("projects", name);
  if (!record) {
    throw new Error(`Project not found: ${name}`);
  }

  const errors = [
    ...importGraph(map.value, record.process),
    ...importGraph(skipMap.value, record.skip),
    ...validateProjectExtensions(record.process, map.value.extensions),
    ...validateProjectExtensions(record.skip, skipMap.value.extensions),
  ];

  clearPrefetch();
  if (Array.isArray(record.queue)) {
    replaceQueue(record.queue);
  }
  if (record.generator) {
    applyGeneratorSnapshot(record.generator as GeneratorSnapshot);
  }
  if (record.wiki) {
    applyWiki(record.wiki);
    await persistWikiConfig();
  }
  if (typeof record.editSummary === "string") {
    editSummary.value = record.editSummary;
  }

  syncPreviewInputs();

  return errors;
}

export async function listProjects(): Promise<string[]> {
  const db = await openPillbugDB();
  return (await db.getAllKeys("projects")).sort();
}

export interface ProjectListItem {
  name: string;
  updatedAt: number;
}

export async function listProjectRecords(): Promise<ProjectListItem[]> {
  const db = await openPillbugDB();
  const records = await db.getAll("projects");
  return records
    .map((r) => ({ name: r.name, updatedAt: r.updatedAt }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProject(name: string): Promise<ProjectRecord> {
  const db = await openPillbugDB();
  const record = await db.get("projects", name);
  if (!record) {
    throw new Error(`Project not found: ${name}`);
  }
  return record;
}

export async function deleteProject(name: string): Promise<void> {
  const db = await openPillbugDB();
  await db.delete("projects", name);
}

export async function getAllProjects(): Promise<ProjectRecord[]> {
  const db = await openPillbugDB();
  return (await db.getAll("projects")).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export async function deleteAllProjects(): Promise<number> {
  const db = await openPillbugDB();
  const keys = await db.getAllKeys("projects");
  const tx = db.transaction("projects", "readwrite");
  await Promise.all(keys.map((key) => tx.store.delete(key)));
  await tx.done;
  return keys.length;
}

function safeZipFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return (cleaned || "project").slice(0, 180);
}

/** Pack projects into a zip of one JSON file per project. */
export function packProjectsZip(records: ProjectRecord[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const record of records) {
    let fileName = `${safeZipFileName(record.name)}.json`;
    let n = 2;
    while (used.has(fileName.toLowerCase())) {
      fileName = `${safeZipFileName(record.name)}_${n}.json`;
      n += 1;
    }
    used.add(fileName.toLowerCase());
    files[fileName] = strToU8(JSON.stringify(record, null, 2));
  }
  return zipSync(files);
}

/** Unpack project JSON files from a zip. */
export function unpackProjectsZip(data: Uint8Array): ProjectRecord[] {
  const files = unzipSync(data);
  const records: ProjectRecord[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith("/") || bytes.length === 0) continue;
    const base = path.split("/").pop() ?? path;
    if (!base.toLowerCase().endsWith(".json")) continue;
    try {
      records.push(parseProjectRecord(JSON.parse(strFromU8(bytes)) as unknown));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid project in zip (${base}): ${msg}`);
    }
  }
  if (records.length === 0) {
    throw new Error("Zip contains no project JSON files");
  }
  return records;
}

export type SaveCopyMode = "timestamp" | "incremental" | "copy";

const SAVE_COPY_MODE_KEY = "pillbug.saveCopyMode";
const SAVE_COPY_MODES: SaveCopyMode[] = ["timestamp", "incremental", "copy"];

export function getSaveCopyMode(): SaveCopyMode {
  try {
    const raw = localStorage.getItem(SAVE_COPY_MODE_KEY);
    if (raw && (SAVE_COPY_MODES as string[]).includes(raw)) {
      return raw as SaveCopyMode;
    }
  } catch {
    /* ignore */
  }
  return "timestamp";
}

export function setSaveCopyMode(mode: SaveCopyMode): void {
  try {
    localStorage.setItem(SAVE_COPY_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function nextCopyName(
  base: string,
  mode: SaveCopyMode,
  existingNames: string[],
): string {
  const existing = new Set(existingNames);
  if (mode === "timestamp") {
    const stamp = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replace(/:/g, "-");
    let name = `${base}_${stamp}`;
    let n = 2;
    while (existing.has(name)) {
      name = `${base}_${stamp}_${n}`;
      n += 1;
    }
    return name;
  }
  if (mode === "incremental") {
    let n = 1;
    while (existing.has(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
  }
  // copy
  const first = `${base} copy`;
  if (!existing.has(first)) return first;
  let n = 2;
  while (existing.has(`${base} copy ${n}`)) n += 1;
  return `${base} copy ${n}`;
}

function isGraphDocument(value: unknown): value is GraphDocument {
  return typeof value === "object" && value !== null;
}

export function parseProjectRecord(raw: unknown): ProjectRecord {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid project file: expected an object");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || !obj.name.trim()) {
    throw new Error("Invalid project file: missing name");
  }
  if (!isGraphDocument(obj.process) || !isGraphDocument(obj.skip)) {
    throw new Error("Invalid project file: missing process/skip graphs");
  }
  return {
    name: obj.name.trim(),
    updatedAt:
      typeof obj.updatedAt === "number" ? obj.updatedAt : Date.now(),
    process: obj.process,
    skip: obj.skip,
    queue: Array.isArray(obj.queue)
      ? obj.queue.filter((t): t is string => typeof t === "string")
      : undefined,
    generator: obj.generator as GeneratorSnapshot | undefined,
    wiki: obj.wiki as ProjectWikiSnapshot | undefined,
    editSummary:
      typeof obj.editSummary === "string" ? obj.editSummary : undefined,
  };
}

/** Import a record into IDB. Returns the name actually stored (may differ on collision). */
export async function importProject(record: ProjectRecord): Promise<string> {
  const db = await openPillbugDB();
  const existing = new Set(await db.getAllKeys("projects"));
  let name = record.name.trim();
  if (!name) {
    throw new Error("Invalid project: empty name");
  }
  if (existing.has(name)) {
    const imported = `${name} (imported)`;
    if (!existing.has(imported)) {
      name = imported;
    } else {
      let n = 2;
      while (existing.has(`${name} (imported ${n})`)) n += 1;
      name = `${name} (imported ${n})`;
    }
  }
  const toStore: ProjectRecord = {
    ...record,
    name,
    updatedAt: Date.now(),
  };
  await db.put("projects", toStore);
  return name;
}

/** Warn when a saved graph references packs that are not loaded on the map. */
function validateProjectExtensions(
  doc: GraphDocument,
  loadedExtensionIds: string[],
): string[] {
  const loaded = new Set(loadedExtensionIds);
  return (doc.extensions ?? [])
    .filter((id) => !loaded.has(id))
    .map((id) => `Missing extension: ${id}`);
}
