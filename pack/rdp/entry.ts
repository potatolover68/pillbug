/**
 * Standalone entry for Replace Deprecated Parameters (userscript / ESM import).
 * Does not depend on nodish or the pillbug app shell.
 */

import {
  clearDeprecatedParamsCache,
  replaceDeprecatedParametersInContent,
} from "../deprecatedParams.ts";
import {
  setPageContentsFetcher,
  type PageContentsResult,
} from "../pageContents.ts";

export {
  clearDeprecatedParamsCache,
  replaceDeprecatedParametersInContent,
} from "../deprecatedParams.ts";
export { setPageContentsFetcher } from "../pageContents.ts";

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

function fetchPageContentsSync(title: string): PageContentsResult {
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
  const sep = apiRoot.includes("?") ? "&" : "?";
  const url = `${apiRoot}${sep}${params.toString()}`;
  // @ts-ignore
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
    return { exists: true, content: "" };
  }

  return { exists: false, content: "" };
}

function installDefaultFetcher(): void {
  setPageContentsFetcher(fetchPageContentsSync);
}

export function configure(options: { apiRoot?: string } = {}): void {
  if (typeof options.apiRoot === "string" && options.apiRoot.trim()) {
    apiRoot = options.apiRoot.trim();
  }
  installDefaultFetcher();
}

function requireContent(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string content");
  }
  return value;
}

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

installDefaultFetcher();
