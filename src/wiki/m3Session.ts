import BrowserSession from "m3api/browser.js";

function actionApiUrl(wikiOrigin: string): string {
  return `${wikiOrigin.replace(/\/$/, "")}/w/api.php`;
}

/**
 * m3api browser session aimed at the configured wiki origin
 * (Toolforge / direct; no same-origin proxy header).
 */
export class PillbugSession extends BrowserSession {
  wikiOrigin: string;

  constructor(wikiOrigin: string, userAgent: string) {
    super(
      actionApiUrl(wikiOrigin),
      { formatversion: 2 },
      {
        userAgent,
        "m3api-botpassword/assert": true,
        "m3api-botpassword/assertUser": false,
      },
    );
    this.wikiOrigin = wikiOrigin;
  }

  /** Keep apiUrl in sync when Config switches wiki origin. */
  setWikiOrigin(wikiOrigin: string): void {
    this.wikiOrigin = wikiOrigin;
    this.apiUrl = actionApiUrl(wikiOrigin);
  }

  getFetchOptions(fetchOptions: RequestInit): RequestInit {
    const base = super.getFetchOptions(fetchOptions);
    return {
      ...base,
      credentials: "include",
    };
  }
}
