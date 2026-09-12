/**
 * Wiki page-content fetchers installed by the app or RDP entry.
 * Graph nodes use the async path with AbortSignal; sync remains for RDP execute().
 */

export type PageContentsResult = {
  exists: boolean;
  content: string;
  resolvedTitle?: string;
};

export type PageContentsFetcher = (title: string) => PageContentsResult;
export type PageContentsFetcherAsync = (
  title: string,
  signal?: AbortSignal,
) => Promise<PageContentsResult>;

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

let pageContentsFetcher: PageContentsFetcher | null = null;
let pageContentsFetcherAsync: PageContentsFetcherAsync | null = null;

export function setPageContentsFetcher(fetcher: PageContentsFetcher): void {
  pageContentsFetcher = fetcher;
}

export function setPageContentsFetcherAsync(
  fetcher: PageContentsFetcherAsync,
): void {
  pageContentsFetcherAsync = fetcher;
}

/** Sync fetch — RDP `execute()` and fallback when no async fetcher is installed. */
export function fetchPageContents(title: string): PageContentsResult {
  if (!pageContentsFetcher) {
    throw new Error("Page fetch is not available (app bridge not installed)");
  }
  return pageContentsFetcher(title);
}

/** Async fetch — nodish `io` nodes and RDP `executeAsync`. */
export async function fetchPageContentsAsync(
  title: string,
  signal?: AbortSignal,
): Promise<PageContentsResult> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
  }
  if (pageContentsFetcherAsync) {
    return pageContentsFetcherAsync(title, signal);
  }
  if (pageContentsFetcher) {
    return pageContentsFetcher(title);
  }
  throw new Error("Page fetch is not available (app bridge not installed)");
}
