import { marked } from "marked";
import changelogIndex from "../../../changelogs/changelogs.json";

export interface ChangelogEntry {
  version: string;
  date: string;
  html: string;
}

interface ChangelogIndexEntry {
  version: string;
  date: string;
}

const mdModules = import.meta.glob("../../../changelogs/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function mdForVersion(version: string): string | null {
  const suffix = `/changelogs/${version}.md`;
  for (const [path, source] of Object.entries(mdModules)) {
    if (path.replace(/\\/g, "/").endsWith(suffix)) {
      return source;
    }
  }
  return null;
}

function compareNewestFirst(a: ChangelogIndexEntry, b: ChangelogIndexEntry): number {
  const byDate = b.date.localeCompare(a.date);
  if (byDate !== 0) return byDate;
  return b.version.localeCompare(a.version, undefined, { numeric: true });
}

export function loadChangelogs(): ChangelogEntry[] {
  const index = changelogIndex as ChangelogIndexEntry[];
  const entries: ChangelogEntry[] = [];

  for (const item of [...index].sort(compareNewestFirst)) {
    const source = mdForVersion(item.version);
    if (source == null) {
      console.warn(`Missing changelog markdown for ${item.version}`);
      continue;
    }
    entries.push({
      version: item.version,
      date: item.date,
      html: marked.parse(source, { async: false }) as string,
    });
  }

  return entries;
}
