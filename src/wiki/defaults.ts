/** Shared wiki defaults (safe for Vite config and browser code). */
export const DEFAULT_WIKI_ORIGIN = "https://en.wikipedia.org";

/** Browser → app proxy: which MediaWiki origin to forward `/w/*` to. */
export const WIKI_ORIGIN_HEADER = "x-pillbug-wiki-origin";
