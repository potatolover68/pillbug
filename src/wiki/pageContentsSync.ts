/**
 * Wiki page read for nodish `io` nodes (async fetch) and RDP sync execute.
 * Uses the same-origin `/w/api.php` proxy.
 */
import {
  isAbortError,
  setPageContentsFetcher,
  setPageContentsFetcherAsync,
  type PageContentsResult,
} from "../../pack/pageContents";
import { setWikiOriginProvider } from "../../pack/deprecatedParams";
import { DEFAULT_WIKI_ORIGIN, WIKI_ORIGIN_HEADER } from "./defaults";
import { wikiOrigin } from "./session";

type Revision = {
  slots?: { main?: { ["*"]?: string; content?: string } };
  ["*"]?: string;
};

type QueryPage = {
  title?: string;
  missing?: boolean | "";
  invalid?: boolean | "";
  revisions?: Revision[];
};

type QueryResponse = {
  query?: {
    pages?: Record<string, QueryPage>;
    redirects?: Array<{ from: string; to: string }>;
  };
  error?: { code?: string; info?: string };
};

function normalizedWikiOrigin(): string {
  try {
    return new URL(wikiOrigin.value.trim() || DEFAULT_WIKI_ORIGIN).origin;
  } catch {
    return DEFAULT_WIKI_ORIGIN;
  }
}

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

function resolvedTitleFromQuery(
  data: QueryResponse,
  page: QueryPage,
): string | undefined {
  const redirects = data.query?.redirects;
  if (redirects && redirects.length > 0) {
    return redirects[redirects.length - 1]!.to;
  }
  return typeof page.title === "string" ? page.title : undefined;
}

function parseQueryResponse(text: string): PageContentsResult {
  let data: QueryResponse;
  try {
    data = JSON.parse(text) as QueryResponse;
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
    const resolvedTitle = resolvedTitleFromQuery(data, page);
    const content = revisionWikitext(page);
    if (content != null) {
      return { exists: true, content, resolvedTitle };
    }
    return { exists: true, content: "", resolvedTitle };
  }

  return { exists: false, content: "" };
}

function queryUrl(title: string): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    redirects: "1",
    titles: title,
  });
  return `/w/api.php?${params.toString()}`;
}

function fetchPageContentsSync(title: string): PageContentsResult {
  const trimmed = title.trim();
  if (!trimmed) {
    return { exists: false, content: "" };
  }

  const xhr = new XMLHttpRequest();
  xhr.open("GET", queryUrl(trimmed), false);
  xhr.setRequestHeader(WIKI_ORIGIN_HEADER, normalizedWikiOrigin());
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

async function fetchPageContentsViaFetch(
  title: string,
  signal?: AbortSignal,
): Promise<PageContentsResult> {
  const trimmed = title.trim();
  if (!trimmed) {
    return { exists: false, content: "" };
  }

  let res: Response;
  try {
    res = await fetch(queryUrl(trimmed), {
      credentials: "include",
      headers: { [WIKI_ORIGIN_HEADER]: normalizedWikiOrigin() },
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error(
      err instanceof Error
        ? `Failed to fetch page: ${err.message}`
        : "Failed to fetch page",
    );
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Failed to fetch page (HTTP ${res.status})`);
  }

  return parseQueryResponse(await res.text());
}

/** Register fetchers used by wiki/get-page-contents and RDP. */
export function installPageContentsFetcher(): void {
  setPageContentsFetcher(fetchPageContentsSync);
  setPageContentsFetcherAsync(fetchPageContentsViaFetch);
}

installPageContentsFetcher();
setWikiOriginProvider(() => wikiOrigin.value);
