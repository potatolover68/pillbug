import { set } from "m3api/browser.js";
import type { PillbugSession } from "./m3Session";
import { WikiTitle } from "./title";

const LIST_SOFT_CAP = 5000;

export type RedirectFilter = "all" | "redirects" | "nonredirects";

export type QueueSource =
  | {
      kind: "category";
      title: string;
      includePages: boolean;
      includeSubcats: boolean;
      includeFiles: boolean;
    }
  | {
      kind: "linksTo";
      title: string;
      wikilinks: boolean;
      transclusions: boolean;
      fileUsage: boolean;
      redirects: RedirectFilter;
      includeLinksToRedirects: boolean;
    }
  | {
      kind: "prefix";
      prefix: string;
      strict: boolean;
    }
  | {
      kind: "linksOn";
      title: string;
    }
  | {
      kind: "search";
      query: string;
    };

type QueryResponse = {
  continue?: Record<string, string | number>;
  query?: Record<string, unknown>;
};

function namespaceParam(namespaces: number[]): Set<number> | undefined {
  if (namespaces.length === 0) return undefined;
  return set(...namespaces) as Set<number>;
}

function titleFromRow(row: { title?: string }): string | null {
  return typeof row.title === "string" && row.title ? row.title : null;
}

function dedupePreserveOrder(titles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const title of titles) {
    const key = title.replace(/_/g, " ");
    if (seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    out.push(title);
  }
  return out;
}

/**
 * Paginate an Action API list/generator query until exhausted or soft cap.
 */
async function queryListPages(
  session: PillbugSession,
  baseParams: Record<string, unknown>,
  extract: (query: Record<string, unknown>) => string[],
  softCap = LIST_SOFT_CAP,
): Promise<string[]> {
  const titles: string[] = [];
  let cont: Record<string, string | number> | undefined;

  while (titles.length < softCap) {
    const params: Record<string, unknown> = {
      action: "query",
      ...baseParams,
      ...(cont ?? {}),
    };
    const data = (await session.request(params, {
      method: "GET",
    })) as QueryResponse;

    const batch = data.query ? extract(data.query) : [];
    for (const title of batch) {
      titles.push(title);
      if (titles.length >= softCap) break;
    }

    if (!data.continue || batch.length === 0) break;
    cont = data.continue;
  }

  return dedupePreserveOrder(titles);
}

function filterredir(redirects: RedirectFilter): string {
  if (redirects === "redirects") return "redirects";
  if (redirects === "nonredirects") return "nonredirects";
  return "all";
}

export async function listFromSource(
  session: PillbugSession,
  source: QueueSource,
  namespaces: number[],
): Promise<string[]> {
  WikiTitle.checkData();
  const ns = namespaceParam(namespaces);

  switch (source.kind) {
    case "category": {
      const types: string[] = [];
      if (source.includePages) types.push("page");
      if (source.includeSubcats) types.push("subcat");
      if (source.includeFiles) types.push("file");
      if (types.length === 0) {
        throw new Error("Select at least one category member type");
      }
      let cmtitle = source.title.trim();
      if (!cmtitle) throw new Error("Category title is required");
      if (!/^Category:/i.test(cmtitle)) {
        cmtitle = `Category:${cmtitle}`;
      }
      return queryListPages(
        session,
        {
          list: set("categorymembers"),
          cmtitle,
          cmtype: set(...types),
          cmlimit: "max",
          ...(ns ? { cmnamespace: ns } : {}),
        },
        (query) => {
          const rows = (query.categorymembers as Array<{ title?: string }>) ?? [];
          return rows.map(titleFromRow).filter((t): t is string => Boolean(t));
        },
      );
    }

    case "linksTo": {
      if (!source.title.trim()) throw new Error("Target page title is required");
      if (!source.wikilinks && !source.transclusions && !source.fileUsage) {
        throw new Error("Select at least one link type");
      }
      const parts: string[][] = [];
      const redir = filterredir(source.redirects);

      if (source.wikilinks) {
        parts.push(
          await queryListPages(
            session,
            {
              list: set("backlinks"),
              bltitle: source.title.trim(),
              bllimit: "max",
              blfilterredir: redir,
              ...(source.includeLinksToRedirects ? { blredirect: true } : {}),
              ...(ns ? { blnamespace: ns } : {}),
            },
            (query) => {
              const rows = (query.backlinks as Array<{ title?: string }>) ?? [];
              return rows.map(titleFromRow).filter((t): t is string => Boolean(t));
            },
          ),
        );
      }

      if (source.transclusions) {
        parts.push(
          await queryListPages(
            session,
            {
              list: set("embeddedin"),
              eititle: source.title.trim(),
              eilimit: "max",
              eifilterredir: redir,
              ...(ns ? { einamespace: ns } : {}),
            },
            (query) => {
              const rows = (query.embeddedin as Array<{ title?: string }>) ?? [];
              return rows.map(titleFromRow).filter((t): t is string => Boolean(t));
            },
          ),
        );
      }

      if (source.fileUsage) {
        let iutitle = source.title.trim();
        if (!/^File:/i.test(iutitle) && !/^Image:/i.test(iutitle)) {
          iutitle = `File:${iutitle}`;
        }
        parts.push(
          await queryListPages(
            session,
            {
              list: set("imageusage"),
              iutitle,
              iulimit: "max",
              iufilterredir: redir,
              ...(ns ? { iunamespace: ns } : {}),
            },
            (query) => {
              const rows = (query.imageusage as Array<{ title?: string }>) ?? [];
              return rows.map(titleFromRow).filter((t): t is string => Boolean(t));
            },
          ),
        );
      }

      return dedupePreserveOrder(parts.flat()).slice(0, LIST_SOFT_CAP);
    }

    case "prefix": {
      const prefix = source.prefix.trim();
      if (!prefix) throw new Error("Prefix is required");

      if (source.strict) {
        // allpages is single-namespace; query each selected ns (or main if none).
        const nsList = namespaces.length > 0 ? namespaces : [0];
        const parts: string[][] = [];
        for (const namespace of nsList) {
          parts.push(
            await queryListPages(
              session,
              {
                list: set("allpages"),
                apprefix: prefix,
                apnamespace: namespace,
                aplimit: "max",
              },
              (query) => {
                const rows = (query.allpages as Array<{ title?: string }>) ?? [];
                return rows.map(titleFromRow).filter((t): t is string => Boolean(t));
              },
            ),
          );
          if (parts.flat().length >= LIST_SOFT_CAP) break;
        }
        return dedupePreserveOrder(parts.flat()).slice(0, LIST_SOFT_CAP);
      }

      return queryListPages(
        session,
        {
          list: set("prefixsearch"),
          pssearch: prefix,
          pslimit: "max",
          ...(ns ? { psnamespace: ns } : {}),
        },
        (query) => {
          const rows = (query.prefixsearch as Array<{ title?: string }>) ?? [];
          return rows.map(titleFromRow).filter((t): t is string => Boolean(t));
        },
      );
    }

    case "linksOn": {
      if (!source.title.trim()) throw new Error("Page title is required");
      return queryListPages(
        session,
        {
          titles: source.title.trim(),
          generator: "links",
          gpllimit: "max",
          ...(ns ? { gplnamespace: ns } : {}),
          prop: set("info"),
        },
        (query) => {
          const pages = query.pages;
          if (Array.isArray(pages)) {
            return (pages as Array<{ title?: string; missing?: boolean }>)
              .filter((p) => p && !p.missing)
              .map(titleFromRow)
              .filter((t): t is string => Boolean(t));
          }
          if (!pages || typeof pages !== "object") return [];
          return Object.values(
            pages as Record<string, { title?: string; missing?: boolean }>,
          )
            .filter((p) => p && !p.missing)
            .map(titleFromRow)
            .filter((t): t is string => Boolean(t));
        },
      );
    }

    case "search": {
      const query = source.query.trim();
      if (!query) throw new Error("Search term is required");
      return queryListPages(
        session,
        {
          list: set("search"),
          srsearch: query,
          srlimit: "max",
          ...(ns ? { srnamespace: ns } : {}),
        },
        (q) => {
          const rows = (q.search as Array<{ title?: string }>) ?? [];
          return rows.map(titleFromRow).filter((t): t is string => Boolean(t));
        },
      );
    }

    default: {
      const _exhaustive: never = source;
      throw new Error(`Unknown source: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Namespace options for the Generate UI (id + display label). */
export function namespaceOptions(): Array<{ id: number; label: string }> {
  WikiTitle.checkData();
  return Object.entries(WikiTitle.idNameMap)
    .map(([id, name]) => ({
      id: Number(id),
      label: name === "" ? "(main)" : name,
    }))
    .filter((ns) => ns.id >= 0)
    .sort((a, b) => a.id - b.id);
}
