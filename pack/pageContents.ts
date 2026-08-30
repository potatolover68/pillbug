/**
 * Sync page-content fetch for graph nodes (execute is sync-only).
 * Async fetch for standalone RDP / userscripts.
 * App or RDP entry installs fetchers via the setters below.
 */

export type PageContentsResult = {
  exists: boolean;
  content: string;
  resolvedTitle?: string;
};

export type PageContentsFetcher = (title: string) => PageContentsResult;
export type PageContentsFetcherAsync = (
  title: string,
) => Promise<PageContentsResult>;

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

/** Sync fetch — used by nodish wiki nodes. */
export function fetchPageContents(title: string): PageContentsResult {
  if (!pageContentsFetcher) {
    throw new Error("Page fetch is not available (app bridge not installed)");
  }
  return pageContentsFetcher(title);
}

/** Async fetch — used by RDP standalone / userscripts. */
export async function fetchPageContentsAsync(
  title: string,
): Promise<PageContentsResult> {
  if (pageContentsFetcherAsync) {
    return pageContentsFetcherAsync(title);
  }
  if (pageContentsFetcher) {
    return pageContentsFetcher(title);
  }
  throw new Error("Page fetch is not available (app bridge not installed)");
}
