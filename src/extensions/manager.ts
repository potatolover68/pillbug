import type { ExtensionRecord } from "../db/open";
import { cachePackUrl, uncachePackUrl } from "./cache";
import { rebuildMaps } from "./loader";
import {
  deleteExtension as deleteExtensionRecord,
  getExtension,
  importPackModule,
  putExtension,
} from "./store";

export async function installExtension(url: string): Promise<ExtensionRecord> {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Extension URL is required");
  }

  const response = await fetch(trimmed);
  if (!response.ok) {
    throw new Error(`Failed to fetch extension: ${response.status}`);
  }

  const pack = await importPackModule(trimmed);
  const existing = await getExtension(pack.id);

  if (existing && existing.url !== trimmed) {
    await uncachePackUrl(existing.url);
  }

  await cachePackUrl(trimmed);

  const record: ExtensionRecord = {
    id: pack.id,
    url: trimmed,
    enabled: true,
    installedAt: Date.now(),
  };
  await putExtension(record);
  await rebuildMaps();
  return record;
}

export async function removeExtension(id: string): Promise<void> {
  const record = await getExtension(id);
  if (!record) {
    throw new Error(`Extension not found: ${id}`);
  }

  await deleteExtensionRecord(id);
  await uncachePackUrl(record.url);
  await rebuildMaps();
}
