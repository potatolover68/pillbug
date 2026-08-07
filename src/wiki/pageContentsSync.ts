/**
 * Blocking wiki page read for nodish execute (sync-only).
 * Uses synchronous XHR through the same-origin `/w/api.php` proxy.
 */
import { setPageContentsFetcher } from "../../pack/pageContents";
import { DEFAULT_WIKI_ORIGIN, WIKI_ORIGIN_HEADER } from "./defaults";
import { wikiOrigin } from "./session";

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

function fetchPageContentsSync(title: string): {
  exists: boolean;
  content: string;
} {
  const trimmed = title.trim();
  if (!trimmed) {
    return { exists: false, content: "" };
  }

  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "revisions",
    rvprop: "content",
    rvslots: "main",
    titles: trimmed,
  });
  const url = `/w/api.php?${params.toString()}`;

  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, false);
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

  let data: QueryResponse;
  try {
    data = JSON.parse(xhr.responseText) as QueryResponse;
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
    // Exists but no readable revision (e.g. restricted).
    return { exists: true, content: "" };
  }

  return { exists: false, content: "" };
}

/** Register the sync fetcher used by wiki/get-page-contents. */
export function installPageContentsFetcher(): void {
  setPageContentsFetcher(fetchPageContentsSync);
}

installPageContentsFetcher();
