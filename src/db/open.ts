import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { GraphDocument } from "@nodish/core";
import type { GeneratorSnapshot } from "../tabs/config/generatorState";

export interface ProjectWikiSnapshot {
  wikiOrigin: string;
  username: string;
  userAgent: string;
  prefetchMode: "A" | "B";
}

export interface ProjectRecord {
  name: string;
  updatedAt: number;
  process: GraphDocument;
  skip: GraphDocument;
  /** Optional fields for newer saves; older projects omit these. */
  queue?: string[];
  generator?: GeneratorSnapshot;
  wiki?: ProjectWikiSnapshot;
  editSummary?: string;
}

export interface ExtensionRecord {
  id: string;
  url: string;
  enabled: boolean;
  installedAt: number;
}

export interface WikiConfigRecord {
  id: "default";
  wikiOrigin: string;
  username: string;
  userAgent: string;
  /** Prefetch mode: A = fetch+skip, B = fetch+skip+process */
  prefetchMode?: "A" | "B";
}

interface PillbugDB extends DBSchema {
  projects: {
    key: string;
    value: ProjectRecord;
  };
  extensions: {
    key: string;
    value: ExtensionRecord;
  };
  wikiConfig: {
    key: string;
    value: WikiConfigRecord;
  };
}

const DB_NAME = "pillbug";
/** v5 recreates extensions after a brief v4 removal. */
const DB_VERSION = 5;

export async function openPillbugDB(): Promise<IDBPDatabase<PillbugDB>> {
  return openDB<PillbugDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "name" });
      }
      if (!db.objectStoreNames.contains("extensions")) {
        db.createObjectStore("extensions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("wikiConfig")) {
        db.createObjectStore("wikiConfig", { keyPath: "id" });
      }
    },
  });
}
