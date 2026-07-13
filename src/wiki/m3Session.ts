import BrowserSession from "m3api/browser.js";
import { WIKI_ORIGIN_HEADER } from "./defaults";

/** Same-origin Action API URL (proxied by `npm start` / Vite to the wiki). */
function localActionApiUrl(): string {
  return `${window.location.origin}/w/api.php`;
}

/**
 * m3api session for pillbug's same-origin wiki proxy:
 * credentials + X-Pillbug-Wiki-Origin on every fetch.
 */
export class PillbugSession extends BrowserSession {
  wikiOrigin: string;

  constructor(wikiOrigin: string, userAgent: string) {
    super(
      localActionApiUrl(),
      { formatversion: 2 },
      {
        userAgent,
        "m3api-botpassword/assert": true,
        "m3api-botpassword/assertUser": false,
      },
    );
    this.wikiOrigin = wikiOrigin;
  }

  setWikiOrigin(wikiOrigin: string): void {
    this.wikiOrigin = wikiOrigin;
  }

  getFetchOptions(fetchOptions: RequestInit): RequestInit {
    const base = super.getFetchOptions(fetchOptions);
    const headers = new Headers(base.headers);
    headers.set(WIKI_ORIGIN_HEADER, this.wikiOrigin);
    return {
      ...base,
      headers,
      credentials: "include",
    };
  }
}
