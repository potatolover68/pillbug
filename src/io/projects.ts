import {
  importGraph,
  serializeDocument,
  type GraphDocument,
} from "@nodish/core";
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
import {
  applyWikiOrigin,
  persistWikiConfig,
  prefetchMode,
  userAgent,
  username,
  wikiOrigin,
} from "../wiki/session";

function collectWiki(): ProjectWikiSnapshot {
  return {
    wikiOrigin: wikiOrigin.value,
    username: username.value,
    userAgent: userAgent.value,
    prefetchMode: prefetchMode.value,
  };
}

function applyWiki(snap: ProjectWikiSnapshot): void {
  applyWikiOrigin(snap.wikiOrigin);
  username.value = snap.username;
  userAgent.value = snap.userAgent;
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
