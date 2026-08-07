/**
 * Sync page-content fetch for graph nodes (execute is sync-only).
 * App installs the fetcher via {@link setPageContentsFetcher}.
 */

export type PageContentsResult = {
  exists: boolean;
  content: string;
};

export type PageContentsFetcher = (title: string) => PageContentsResult;

let pageContentsFetcher: PageContentsFetcher | null = null;

export function setPageContentsFetcher(fetcher: PageContentsFetcher): void {
  pageContentsFetcher = fetcher;
}

export function fetchPageContents(title: string): PageContentsResult {
  if (!pageContentsFetcher) {
    throw new Error("Page fetch is not available (app bridge not installed)");
  }
  return pageContentsFetcher(title);
}
