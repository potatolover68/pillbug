/**
 * Standalone entry for Replace Deprecated Parameters (userscript / ESM import).
 * Does not depend on nodish or the pillbug app shell.
 *
 * Default path is async `fetch` + IndexedDB rules cache (1h TTL).
 * Sync XHR fetcher remains available for sync helpers / nodish parity.
 */

import {
  replaceDeprecatedParametersInContent,
  replaceDeprecatedParametersInContentAsync,
} from "../deprecatedParams.ts";
import {
  setPageContentsFetcher,
  setPageContentsFetcherAsync,
  type PageContentsResult,
} from "../pageContents.ts";

export {
  clearDeprecatedParamsCache,
  clearDeprecatedParamsCacheAsync,
  getDeprecatedParamsRulesAsync,
  replaceDeprecatedParametersInContent,
  replaceDeprecatedParametersInContentAsync,
  RULES_CACHE_TTL_MS,
} from "../deprecatedParams.ts";
export {
  setPageContentsFetcher,
  setPageContentsFetcherAsync,
} from "../pageContents.ts";

type Revision = {
  slots?: { main?: { ["*"]?: string; content?: string } };
  ["*"]?: string;
};

type QueryPage = {
  missing?: boolean | "";
  invalid?: boolean | "";
  revisions?: Revision[];
};

type QueryResponse = {
  query?: { pages?: Record<string, QueryPage> };
  error?: { code?: string; info?: string };
};

let apiRoot = "/w/api.php";

function revisionWikitext(page: QueryPage): string | null {
  const rev = page.revisions?.[0];
  if (!rev) return null;
  const slot = rev.slots?.main;
  if (slot) {
    const text = slot["*"] ?? slot.content;
    if (typeof text === "string") return text;
  }
  if (typeof rev["*"] === "string") return rev["*"];
  return null;
}

function parseQueryResponse(raw: string): PageContentsResult {
  let data: QueryResponse;
  try {
    data = JSON.parse(raw) as QueryResponse;
  } catch {
    throw new Error("Failed to parse wiki API response");
  }

  if (data.error) {
    throw new Error(data.error.info ?? data.error.code ?? "Wiki API error");
  }

  const pages = data.query?.pages;
  if (!pages) {
    return { exists: false, content: "" };
  }

  for (const page of Object.values(pages)) {
    if (page.missing !== undefined || page.invalid !== undefined) {
      return { exists: false, content: "" };
    }
    const content = revisionWikitext(page);
    if (content != null) {
      return { exists: true, content };
    }
    return { exists: true, content: "" };
  }

  return { exists: false, content: "" };
}

function buildApiUrl(title: string): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    titles: title,
  });
  const sep = apiRoot.includes("?") ? "&" : "?";
  return `${apiRoot}${sep}${params.toString()}`;
}

/** Sync XHR — for sync `replaceDeprecatedParametersInContent` / nodish-style use. */
function fetchPageContentsSync(title: string): PageContentsResult {
  const trimmed = title.trim();
  if (!trimmed) {
    return { exists: false, content: "" };
  }

  const url = buildApiUrl(trimmed);
  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
  xhr.withCredentials = true;
  try {
    xhr.send(null);
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Failed to fetch page: ${err.message}`
        : "Failed to fetch page",
    );
  }

  if (xhr.status < 200 || xhr.status >= 300) {
    throw new Error(`Failed to fetch page (HTTP ${xhr.status})`);
  }

  return parseQueryResponse(xhr.responseText);
}

/** Async fetch — default for RDP userscripts. */
async function fetchPageContentsViaFetch(
  title: string,
): Promise<PageContentsResult> {
  const trimmed = title.trim();
  if (!trimmed) {
    return { exists: false, content: "" };
  }

  const url = buildApiUrl(trimmed);
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin" });
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Failed to fetch page: ${err.message}`
        : "Failed to fetch page",
    );
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch page (HTTP ${res.status})`);
  }

  return parseQueryResponse(await res.text());
}

function installDefaultFetchers(): void {
  setPageContentsFetcher(fetchPageContentsSync);
  setPageContentsFetcherAsync(fetchPageContentsViaFetch);
}

/** Update MediaWiki API endpoint (default `/w/api.php`) and re-install fetchers. */
export function configure(options: { apiRoot?: string } = {}): void {
  if (typeof options.apiRoot === "string" && options.apiRoot.trim()) {
    apiRoot = options.apiRoot.trim();
  }
  installDefaultFetchers();
}

function requireContent(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string content");
  }
  return value;
}

/** Sync execute (blocks on XHR). Prefer {@link executeAsync} in userscripts. */
export function execute(inputs: {
  title: unknown;
  content: unknown;
  fixindent?: unknown;
}): { contentAfter: string } {
  return {
    contentAfter: replaceDeprecatedParametersInContent(
      inputs.title,
      requireContent(inputs.content),
      inputs.fixindent === true,
    ),
  };
}

/** Async execute — uses fetch + IndexedDB rules cache. */
export async function executeAsync(inputs: {
  title: unknown;
  content: unknown;
  fixindent?: unknown;
}): Promise<{ contentAfter: string }> {
  return {
    contentAfter: await replaceDeprecatedParametersInContentAsync(
      inputs.title,
      requireContent(inputs.content),
      inputs.fixindent === true,
    ),
  };
}

installDefaultFetchers();
