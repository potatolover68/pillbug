import type { NodePack } from "@nodish/core";
import { openPillbugDB, type ExtensionRecord } from "../db/open";

export async function listExtensions(): Promise<ExtensionRecord[]> {
  const db = await openPillbugDB();
  return db.getAll("extensions");
}

export async function getEnabledExtensions(): Promise<ExtensionRecord[]> {
  const extensions = await listExtensions();
  return extensions.filter((ext) => ext.enabled);
}

export async function getExtension(
  id: string,
): Promise<ExtensionRecord | undefined> {
  const db = await openPillbugDB();
  return db.get("extensions", id);
}

export async function putExtension(record: ExtensionRecord): Promise<void> {
  const db = await openPillbugDB();
  await db.put("extensions", record);
}

export async function deleteExtension(id: string): Promise<void> {
  const db = await openPillbugDB();
  await db.delete("extensions", id);
}

export async function importPackModule(url: string): Promise<NodePack> {
  const mod: { pack?: NodePack } = await import(/* @vite-ignore */ url);
  if (!mod.pack?.id) {
    throw new Error("Extension module must export { pack: NodePack }");
  }
  return mod.pack;
}
